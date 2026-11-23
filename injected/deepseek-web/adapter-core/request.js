import { AdapterError, ERROR_CODES } from './errors.js';

/** @typedef {'not_sent' | 'unknown' | 'confirmed'} Delivery */
/** @typedef {'validating' | 'checking_page' | 'configuring_options' | 'preparing_input' | 'ready_to_send' | 'send_attempted' | 'sent' | 'awaiting_response' | 'generating' | 'completed' | 'failed' | 'uncertain' | 'cancelled'} RequestState */

const TERMINAL_STATES = new Set([
  'completed',
  'failed',
  'uncertain',
  'cancelled',
]);

/** @type {Record<RequestState, readonly RequestState[]>} */
const TRANSITIONS = Object.freeze({
  validating: ['checking_page', 'failed', 'cancelled'],
  checking_page: ['configuring_options', 'failed', 'cancelled'],
  configuring_options: ['preparing_input', 'failed', 'cancelled'],
  preparing_input: ['ready_to_send', 'failed', 'cancelled'],
  ready_to_send: ['send_attempted', 'failed', 'cancelled'],
  send_attempted: ['sent', 'failed', 'uncertain', 'cancelled'],
  sent: ['awaiting_response', 'failed', 'uncertain', 'cancelled'],
  awaiting_response: ['generating', 'failed', 'uncertain', 'cancelled'],
  generating: ['completed', 'failed', 'uncertain', 'cancelled'],
  completed: [],
  failed: [],
  uncertain: [],
  cancelled: [],
});

export const REQUEST_TRANSITIONS = TRANSITIONS;

export class RequestContext {
  /**
   * @param {{
   *   requestId: string,
   *   sessionId: string,
   *   timeoutMs: number,
   *   now?: () => number,
   * }} options
   */
  constructor(options) {
    this.requestId = options.requestId;
    this.sessionId = options.sessionId;
    this.timeoutMs = options.timeoutMs;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.deadlineAt = this.startedAt + options.timeoutMs;
    /** @type {RequestState | null} */
    this.previousState = null;
    /** @type {RequestState} */
    this.state = 'validating';
    /** @type {Delivery} */
    this.delivery = 'not_sent';
    this.remoteState = 'not_started';
    this.abortController = new AbortController();
    /** @type {Set<() => void>} */
    this.cleanupCallbacks = new Set();
    this.finished = false;
  }

  get signal() {
    return this.abortController.signal;
  }

  /**
   * @param {RequestState} nextState
   * @returns {RequestState}
   */
  transition(nextState) {
    const allowed = TRANSITIONS[this.state];
    if (!allowed.includes(nextState)) {
      throw new AdapterError(
        ERROR_CODES.ILLEGAL_STATE_TRANSITION,
        `Illegal request state transition: ${this.state} -> ${nextState}`,
        {
          stage: this.state,
          delivery: this.delivery,
          remoteState: this.remoteState,
          retryable: false,
          diagnostics: {
            state: nextState,
            previousState: this.state,
          },
        },
      );
    }

    this.previousState = this.state;
    this.state = nextState;
    if (TERMINAL_STATES.has(nextState)) {
      this.finish();
    }
    return this.state;
  }

  markSendAttempted() {
    this.transition('send_attempted');
    this.delivery = 'unknown';
  }

  markSent() {
    this.transition('sent');
    this.delivery = 'confirmed';
  }

  /**
   * @returns {number}
   */
  remainingMs() {
    return Math.max(0, this.deadlineAt - this.now());
  }

  /**
   * Run an operation against this request's existing absolute deadline.
   *
   * @template T
   * @param {(signal: AbortSignal) => PromiseLike<T> | T} promiseFactory
   * @param {number} [stageLimitMs]
   * @returns {Promise<T>}
   */
  runWithDeadline(promiseFactory, stageLimitMs) {
    if (this.finished) {
      return Promise.reject(this.abortReason());
    }

    const timeoutError = () =>
      new AdapterError(
        ERROR_CODES.RESPONSE_TIMEOUT,
        'Request deadline exceeded',
        {
          stage: this.state,
          delivery: this.delivery,
          remoteState: this.remoteState,
          retryable: false,
          diagnostics: { timeoutMs: this.timeoutMs },
        },
      );
    const remainingMs = this.remainingMs();
    if (remainingMs <= 0) {
      const error = timeoutError();
      this.abortController.abort(error);
      this.transition(this.delivery === 'not_sent' ? 'failed' : 'uncertain');
      return Promise.reject(error);
    }

    const waitMs =
      stageLimitMs === undefined
        ? remainingMs
        : Math.min(remainingMs, Math.max(0, stageLimitMs));

    return new Promise((resolve, reject) => {
      let settled = false;

      const finishOperation = () => {
        if (settled) {
          return false;
        }
        settled = true;
        unregisterCleanup();
        cleanupOperation();
        return true;
      };
      /** @param {T | PromiseLike<T>} value */
      const resolveOnce = (value) => {
        if (finishOperation()) {
          resolve(value);
        }
      };
      /** @param {unknown} error */
      const rejectOnce = (error) => {
        if (finishOperation()) {
          reject(error);
        }
      };

      const onAbort = () => {
        rejectOnce(this.abortReason());
      };
      const timer = setTimeout(() => {
        if (settled || this.finished) {
          return;
        }
        const error = timeoutError();
        this.abortController.abort(error);
        if (!TERMINAL_STATES.has(this.state)) {
          this.transition(
            this.delivery === 'not_sent' ? 'failed' : 'uncertain',
          );
        }
      }, waitMs);
      const cleanupOperation = () => {
        clearTimeout(timer);
        this.signal.removeEventListener('abort', onAbort);
      };
      const settleTerminalOperation = () => {
        const error = this.terminalReason();
        if (!this.signal.aborted) {
          this.abortController.abort(error);
        }
        rejectOnce(error);
      };
      const unregisterCleanup = this.registerCleanup(settleTerminalOperation);

      this.signal.addEventListener('abort', onAbort, { once: true });
      if (this.signal.aborted) {
        onAbort();
        return;
      }

      try {
        Promise.resolve(promiseFactory(this.signal)).then(
          resolveOnce,
          rejectOnce,
        );
      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  /**
   * @param {() => void} cleanup
   * @returns {() => boolean}
   */
  registerCleanup(cleanup) {
    if (this.finished) {
      cleanup();
      return () => false;
    }

    this.cleanupCallbacks.add(cleanup);
    let registered = true;
    return () => {
      if (!registered) {
        return false;
      }
      registered = false;
      return this.cleanupCallbacks.delete(cleanup);
    };
  }

  /**
   * @param {unknown} [reason]
   * @param {'cancelled' | 'uncertain'} [terminalState]
   * @returns {boolean}
   */
  cancel(reason, terminalState = 'cancelled') {
    if (this.finished || TERMINAL_STATES.has(this.state)) {
      return false;
    }

    const error =
      reason instanceof AdapterError
        ? reason
        : new AdapterError(ERROR_CODES.CANCELLED, 'Request cancelled', {
            stage: this.state,
            delivery: this.delivery,
            remoteState: this.remoteState,
            retryable: false,
            cause: reason,
          });
    this.abortController.abort(error);
    this.transition(terminalState);
    return true;
  }

  /**
   * @returns {boolean}
   */
  finish() {
    if (this.finished) {
      return false;
    }

    this.finished = true;
    const callbacks = [...this.cleanupCallbacks];
    this.cleanupCallbacks.clear();
    for (const cleanup of callbacks) {
      try {
        cleanup();
      } catch {
        // Cleanup is best effort; one resource must not block the rest.
      }
    }
    return true;
  }

  /**
   * @returns {AdapterError}
   */
  terminalReason() {
    if (this.signal.aborted) {
      return this.abortReason();
    }

    /** @type {(typeof ERROR_CODES)[keyof typeof ERROR_CODES]} */
    let code = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Request ended while an operation was pending';
    if (this.state === 'cancelled') {
      code = ERROR_CODES.CANCELLED;
      message = 'Request cancelled';
    } else if (this.state === 'uncertain') {
      code =
        this.delivery === 'confirmed'
          ? ERROR_CODES.RESPONSE_UNCERTAIN
          : ERROR_CODES.SEND_UNCERTAIN;
      message = 'Request outcome is uncertain';
    }

    return new AdapterError(code, message, {
      stage: this.state,
      delivery: this.delivery,
      remoteState: this.remoteState,
      retryable: false,
    });
  }

  /**
   * @returns {AdapterError}
   */
  abortReason() {
    const reason = this.signal.reason;
    if (reason instanceof AdapterError) {
      return reason;
    }
    return new AdapterError(ERROR_CODES.CANCELLED, 'Request cancelled', {
      stage: this.state,
      delivery: this.delivery,
      remoteState: this.remoteState,
      retryable: false,
      cause: reason,
    });
  }
}
