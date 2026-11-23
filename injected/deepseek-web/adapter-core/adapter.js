import { validateGenerateRequest } from './contracts.js';
import {
  AdapterError,
  ERROR_CODES,
  createFailureResult,
  createUncertainResult,
} from './errors.js';
import { createEventHub } from './events.js';
import { PageDriver } from './page.js';
import { RequestContext } from './request.js';

const POST_SEND_STATES = new Set([
  'send_attempted',
  'sent',
  'awaiting_response',
  'generating',
]);

/**
 * @typedef {{
 *   page?: PageDriver,
 *   document?: Document,
 *   window?: Window,
 *   now?: () => number,
 *   toISOString?: (timestamp: number) => string,
 *   pollIntervalMs?: number,
 *   stabilityMs?: number,
 *   onLog?: (event: import('./events.js').LogEvent) => void,
 *   onStateChange?: (event: import('./events.js').StateChangeEvent) => void,
 *   onSubscriberError?: (error: unknown) => void,
 *   onDispose?: () => void,
 * }} AdapterOptions
 */

export class DeepSeekAdapter {
  /** @param {AdapterOptions} [options] */
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.page =
      options.page ??
      new PageDriver({
        document: options.document,
        window: options.window,
        now: this.now,
        pollIntervalMs: options.pollIntervalMs,
        stabilityMs: options.stabilityMs,
      });
    this.events = createEventHub({
      now: this.now,
      toISOString: options.toISOString,
      onLog: options.onLog,
      onStateChange: options.onStateChange,
      onSubscriberError: options.onSubscriberError,
    });
    this.onDispose = options.onDispose ?? (() => {});
    this.initialized = false;
    this.disposed = false;
    this.sessionId = null;
    /** @type {ActiveRequest | null} */
    this.active = null;
    /** @type {Promise<void> | null} */
    this.disposePromise = null;
  }

  async initialize() {
    this.assertNotDisposed();
    if (this.initialized && this.sessionId) {
      this.page.assertSession(this.sessionId, 'initializing');
      return;
    }

    const session = await Promise.resolve(this.page.initialize());
    this.sessionId = session.sessionId;
    this.initialized = true;
  }

  getSession() {
    return this.initialized && this.sessionId ? { id: this.sessionId } : null;
  }

  getCapabilities() {
    return this.page.getCapabilities();
  }

  /** @param {unknown} request */
  async generate(request) {
    const normalized = validateGenerateRequest(request);
    if (this.disposed) {
      return this.runtimeFailure(
        normalized,
        ERROR_CODES.DISPOSED,
        'Adapter has been disposed',
        'validating',
      );
    }
    if (!this.initialized || !this.sessionId) {
      return this.runtimeFailure(
        normalized,
        ERROR_CODES.NOT_INITIALIZED,
        'Adapter must be initialized before generate()',
        'validating',
      );
    }
    if (this.active) {
      return this.runtimeFailure(
        normalized,
        ERROR_CODES.BUSY,
        'Another request is already active',
        'validating',
        true,
      );
    }

    const context = new RequestContext({
      requestId: normalized.requestId,
      sessionId: normalized.sessionId,
      timeoutMs: normalized.options.timeoutMs,
      now: this.now,
    });
    /** @type {ActiveRequest} */
    const active = {
      context,
      cancelRequested: false,
      remoteStop: 'not_attempted',
      remoteStopPromise: null,
      ownership: null,
      settled: null,
      localWaitCancelled: false,
    };
    this.active = active;
    const inputPartCount = /** @type {{ parts: unknown[] }} */ (request).parts
      .length;
    this.log('info', 'request_started', context, {
      partCount: inputPartCount,
      textLength: normalized.text.length,
    });

    try {
      this.transition(context, 'checking_page');
      const composer = await context.runWithDeadline(() =>
        this.page.checkReady(normalized.sessionId),
      );

      this.transition(context, 'configuring_options');
      await context.runWithDeadline(
        (signal) => this.page.configureOptions(normalized.options, signal),
        3_000,
      );
      this.transition(context, 'preparing_input');
      const preparedImage = await context.runWithDeadline((signal) =>
        this.page.prepareInput(
          composer,
          normalized.text,
          normalized.image,
          signal,
          normalized.sessionId,
        ),
      );
      if (preparedImage) {
        context.registerCleanup(() => {
          if (context.delivery === 'not_sent') preparedImage.remove();
        });
        this.log('info', 'attachment_ready', context, {
          verification: 'page_inferred',
          serverConfirmed: false,
          attachmentCount: 1,
          totalBytes: normalized.image?.bytes.length,
        });
      }

      const ownership = this.page.watchComposer(composer, normalized.text);
      active.ownership = ownership;
      context.registerCleanup(() => ownership.dispose());
      this.log('info', 'input_prepared', context, {
        partCount: inputPartCount,
        textLength: normalized.text.length,
      });

      const baseline = await context.runWithDeadline(() =>
        this.page.takeMessageBaseline(),
      );
      this.transition(context, 'ready_to_send');
      await context.runWithDeadline(() =>
        this.page.assertSession(normalized.sessionId, 'ready_to_send'),
      );

      const previousState = context.state;
      context.markSendAttempted();
      this.emitTransition(context, previousState);
      this.log('info', 'message_send_attempted', context, {
        delivery: context.delivery,
      });
      await context.runWithDeadline(() =>
        this.page.send(composer, preparedImage?.name),
      );

      const confirmedUser = await context.runWithDeadline((signal) =>
        this.page.confirmSend(
          signal,
          normalized.sessionId,
          baseline,
          normalized.text,
          ownership,
          preparedImage?.name,
        ),
      );
      const sentPreviousState = context.state;
      context.markSent();
      context.remoteState = 'accepted';
      this.emitTransition(context, sentPreviousState);
      this.log('info', 'message_sent', context, {
        delivery: context.delivery,
      });

      this.transition(context, 'awaiting_response');
      const assistant = await context.runWithDeadline((signal) =>
        this.page.waitForAssistant(
          signal,
          normalized.sessionId,
          baseline,
          confirmedUser,
        ),
      );
      context.remoteState = 'generating';
      this.transition(context, 'generating');
      this.log('info', 'response_started', context);

      const formalContent = await context.runWithDeadline((signal) =>
        this.page.waitForCompletion(
          signal,
          normalized.sessionId,
          baseline,
          confirmedUser,
          assistant,
        ),
      );
      await context.runWithDeadline(() =>
        this.page.assertSession(normalized.sessionId, 'generating'),
      );
      const text = await context.runWithDeadline(() =>
        this.page.extract(formalContent),
      );
      context.remoteState = 'completed';
      this.transition(context, 'completed');
      const durationMs = this.duration(context);
      this.log('info', 'response_completed', context, {
        responseLength: text.length,
      });
      return {
        requestId: context.requestId,
        sessionId: context.sessionId,
        status: 'completed',
        content: text,
        durationMs,
      };
    } catch (error) {
      return await this.handleGenerateError(active, error);
    } finally {
      context.finish();
      if (this.active === active) {
        this.active = null;
      }
      active.settled?.();
    }
  }

  /** @param {string} requestId */
  async cancel(requestId) {
    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new TypeError('requestId must be a nonempty string');
    }
    const active = this.active;
    if (!active || active.context.requestId !== requestId) {
      return {
        requestId,
        localWaitCancelled: false,
        delivery: 'not_sent',
        remoteStop: 'not_attempted',
      };
    }
    if (active.cancelRequested) {
      await active.remoteStopPromise;
      return this.cancelResult(active);
    }

    const context = active.context;
    if (
      ['completed', 'failed', 'uncertain', 'cancelled'].includes(context.state)
    ) {
      return this.cancelResult(active);
    }
    active.cancelRequested = true;
    const postSend = context.delivery !== 'not_sent';
    const cancellationError = new AdapterError(
      ERROR_CODES.CANCELLED,
      'Request cancelled',
      {
        stage: context.state,
        delivery: context.delivery,
        remoteState: context.remoteState,
        retryable: false,
      },
    );
    const localWaitCancelled = !context.signal.aborted;
    active.localWaitCancelled = localWaitCancelled;

    context.abortController.abort(cancellationError);

    if (
      postSend &&
      active.ownership &&
      this.page.canStop(context.sessionId, active.ownership)
    ) {
      this.log('info', 'remote_stop_attempted', context);
      active.remoteStop = 'attempted';
      active.remoteStopPromise = Promise.resolve(
        this.page.tryStop(context.sessionId, active.ownership),
      )
        .then((observed) => {
          if (observed) {
            active.remoteStop = 'observed';
            context.remoteState = 'stopped';
            this.log('info', 'remote_stop_observed', context);
          } else {
            active.remoteStop = 'not_observed';
          }
        })
        .catch(() => {
          active.remoteStop = 'not_observed';
        })
        .finally(() => {
          if (!['cancelled', 'uncertain'].includes(context.state)) {
            context.transition(
              active.remoteStop === 'observed' ? 'cancelled' : 'uncertain',
            );
          }
        });
    }

    if (!active.remoteStopPromise) {
      context.transition(postSend ? 'uncertain' : 'cancelled');
    } else {
      await active.remoteStopPromise;
    }

    return {
      ...this.cancelResult(active),
      localWaitCancelled,
    };
  }

  /** @param {(event: import('./events.js').LogEvent) => void} listener */
  subscribeLogs(listener) {
    return this.events.subscribeLog(listener);
  }

  /**
   * @param {(event: import('./events.js').StateChangeEvent) => void} listener
   */
  subscribeStateChanges(listener) {
    return this.events.subscribeStateChange(listener);
  }

  dispose() {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.disposed = true;
    this.disposePromise = (async () => {
      const active = this.active;
      if (active) {
        /** @type {Promise<void>} */
        const settled = new Promise((resolve) => {
          active.settled = resolve;
        });
        await this.cancel(active.context.requestId);
        await settled;
      }
      this.initialized = false;
      this.sessionId = null;
      this.events.clear();
      this.onDispose();
    })();
    return this.disposePromise;
  }

  /**
   * @param {RequestContext} context
   * @param {import('./request.js').RequestState} state
   * @param {() => unknown} operation
   */
  async stage(context, state, operation) {
    this.transition(context, state);
    return await context.runWithDeadline(operation);
  }

  /**
   * @param {RequestContext} context
   * @param {import('./request.js').RequestState} nextState
   */
  transition(context, nextState) {
    const previousState = context.state;
    context.transition(nextState);
    this.emitTransition(context, previousState);
  }

  /**
   * @param {RequestContext} context
   * @param {string} previousState
   */
  emitTransition(context, previousState) {
    this.events.emitStateChange({
      requestId: context.requestId,
      sessionId: context.sessionId,
      previousState,
      state: context.state,
      stage: context.state,
      startedAt: context.startedAt,
      details: { delivery: context.delivery },
    });
    this.log('info', 'request_state_changed', context, {
      state: context.state,
      previousState,
      delivery: context.delivery,
    });
  }

  /**
   * @param {'info' | 'warn' | 'error'} level
   * @param {string} event
   * @param {RequestContext} context
   * @param {Record<string, unknown>} [details]
   * @param {string} [errorCode]
   */
  log(level, event, context, details, errorCode) {
    this.events.emitLog({
      level,
      event,
      requestId: context.requestId,
      sessionId: context.sessionId,
      stage: context.state,
      startedAt: context.startedAt,
      errorCode,
      details,
    });
  }

  /**
   * @param {ActiveRequest} active
   * @param {unknown} error
   */
  async handleGenerateError(active, error) {
    const context = active.context;
    if (active.remoteStopPromise) {
      await active.remoteStopPromise;
    }
    let adapterError = this.asAdapterError(error, context);
    if (
      context.delivery === 'unknown' &&
      adapterError.code !== ERROR_CODES.SEND_UNCERTAIN &&
      adapterError.code !== ERROR_CODES.CANCELLED &&
      adapterError.code !== ERROR_CODES.PAGE_NAVIGATED &&
      adapterError.code !== ERROR_CODES.SESSION_MISMATCH
    ) {
      adapterError = new AdapterError(
        ERROR_CODES.SEND_UNCERTAIN,
        'Send could not be confirmed',
        {
          stage: 'send_attempted',
          delivery: 'unknown',
          remoteState: context.remoteState,
          retryable: false,
          cause: error,
        },
      );
    }
    const terminalStateWasSetByContext = [
      'failed',
      'uncertain',
      'cancelled',
    ].includes(context.state);
    if (terminalStateWasSetByContext && context.previousState) {
      this.emitTransition(context, context.previousState);
    }
    const wasCancelled =
      active.cancelRequested || adapterError.code === ERROR_CODES.CANCELLED;
    const remoteStopObserved = active.remoteStop === 'observed';
    const postSend =
      context.delivery !== 'not_sent' || POST_SEND_STATES.has(context.state);
    const uncertain = postSend && !remoteStopObserved;

    if (
      !['completed', 'failed', 'uncertain', 'cancelled'].includes(context.state)
    ) {
      this.transition(
        context,
        wasCancelled ? 'cancelled' : uncertain ? 'uncertain' : 'failed',
      );
    }

    if (
      adapterError.code === ERROR_CODES.PAGE_NAVIGATED ||
      adapterError.code === ERROR_CODES.SESSION_MISMATCH
    ) {
      this.log(
        'warn',
        'session_changed',
        context,
        undefined,
        adapterError.code,
      );
    }

    if (wasCancelled) {
      this.log(
        'info',
        'request_cancelled',
        context,
        undefined,
        adapterError.code,
      );
    } else {
      this.log(
        uncertain ? 'warn' : 'error',
        uncertain ? 'request_uncertain' : 'request_failed',
        context,
        undefined,
        adapterError.code,
      );
    }

    const resultContext = this.resultContext(context);
    if (uncertain) {
      return createUncertainResult(resultContext, adapterError);
    }
    return createFailureResult(resultContext, adapterError);
  }

  /**
   * @param {unknown} error
   * @param {RequestContext} context
   */
  asAdapterError(error, context) {
    if (error instanceof AdapterError) {
      if (context.delivery !== 'not_sent' && error.delivery === undefined) {
        error.delivery = context.delivery;
      }
      if (error.remoteState === undefined) {
        error.remoteState = context.remoteState;
      }
      return error;
    }
    return new AdapterError(
      context.delivery === 'not_sent'
        ? ERROR_CODES.INTERNAL_ERROR
        : ERROR_CODES.RESPONSE_UNCERTAIN,
      context.delivery === 'not_sent'
        ? 'Internal adapter error'
        : 'Request outcome is uncertain',
      {
        stage: context.state,
        delivery: context.delivery,
        remoteState: context.remoteState,
        retryable: false,
        cause: error,
      },
    );
  }

  /** @param {RequestContext} context */
  resultContext(context) {
    return {
      requestId: context.requestId,
      sessionId: context.sessionId,
      state: context.state,
      delivery: context.delivery,
      remoteState: context.remoteState,
      durationMs: this.duration(context),
    };
  }

  /** @param {RequestContext} context */
  duration(context) {
    return Math.max(0, this.now() - context.startedAt);
  }

  /**
   * @param {import('./contracts.js').NormalizedGenerateRequest} request
   * @param {typeof ERROR_CODES[keyof typeof ERROR_CODES]} code
   * @param {string} message
   * @param {string} stage
   * @param {boolean} [retryable]
   */
  runtimeFailure(request, code, message, stage, retryable = false) {
    const context = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      state: stage,
      delivery: /** @type {const} */ ('not_sent'),
      remoteState: 'not_started',
      durationMs: 0,
    };
    const error = new AdapterError(code, message, {
      stage,
      delivery: 'not_sent',
      remoteState: 'not_started',
      retryable,
    });
    this.events.emitLog({
      level: 'error',
      event: 'request_failed',
      requestId: request.requestId,
      sessionId: request.sessionId,
      stage,
      errorCode: code,
    });
    return createFailureResult(context, error);
  }

  assertNotDisposed() {
    if (this.disposed) {
      throw new AdapterError(
        ERROR_CODES.DISPOSED,
        'Adapter has been disposed',
        {
          stage: 'initializing',
          retryable: false,
        },
      );
    }
  }

  /** @param {ActiveRequest} active */
  cancelResult(active) {
    return {
      requestId: active.context.requestId,
      localWaitCancelled: active.localWaitCancelled,
      delivery: active.context.delivery,
      remoteStop: active.remoteStop,
    };
  }
}

/**
 * @typedef {{
 *   context: RequestContext,
 *   cancelRequested: boolean,
 *   remoteStop: 'not_attempted' | 'attempted' | 'observed' | 'not_observed',
 *   remoteStopPromise: Promise<void> | null,
 *   ownership: {
 *     composer: HTMLTextAreaElement,
 *     isUnaltered: () => boolean,
 *     dispose: () => void,
 *   } | null,
 *   settled: (() => void) | null,
 *   localWaitCancelled: boolean,
 * }} ActiveRequest
 */
