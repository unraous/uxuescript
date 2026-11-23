/* eslint-disable no-restricted-imports -- synchronized upstream module graph keeps relative imports */
import { AdapterError, ERROR_CODES } from '../errors.js';
import { composerHasImage } from './attachments.js';
import {
  messageSnapshotIndex,
  normalizeMessageText,
  resolveMessageItem,
  snapshotMessages,
} from './messages.js';
import {
  SELECTORS,
  findOperationBar,
  getComposer,
  getMainControl,
  mainControlState,
  visibleText,
} from './selectors.js';

/**
 * @param {{
 *   document: Document,
 *   signal: AbortSignal,
 *   expectedSessionId: string,
 *   getSessionId: () => string | null,
 *   baseline: import('./messages.js').MessageSnapshot[],
 *   expectedText: string,
 *   imageName?: string,
 *   ownership: {
 *     composer: HTMLTextAreaElement,
 *     isUnaltered: () => boolean,
 *   },
 *   pollIntervalMs: number,
 * }} options
 */
export function waitForSendConfirmation(options) {
  return waitForPageCondition({
    ...options,
    check() {
      assertSession(
        options.getSessionId,
        options.expectedSessionId,
        'send_attempted',
      );
      const composer = getComposer(options.document);
      const current = snapshotMessages(options.document);
      const expected = normalizeMessageText(options.expectedText);
      const signature = `user:${expected}${options.imageName ? `:images:${options.imageName}` : ''}`;
      const baselineCount = options.baseline.filter(
        (message) => message.signature === signature,
      ).length;
      const matching = current.filter(
        (message) =>
          message.signature === signature &&
          message.occurrence >= baselineCount,
      );
      const target = matching[0];
      const targetIndex = target ? messageSnapshotIndex(current, target) : -1;
      const competing =
        targetIndex < 0
          ? []
          : current
              .slice(targetIndex + 1)
              .filter((message) => message.role === 'user');
      if (competing.length > 0 || matching.length > 1) {
        throw new AdapterError(
          ERROR_CODES.SEND_UNCERTAIN,
          'A competing user message prevents reliable send confirmation',
          {
            stage: 'send_attempted',
            delivery: 'unknown',
            retryable: false,
            diagnostics: { candidateCount: matching.length },
          },
        );
      }
      if (
        matching.length === 1 &&
        composer === options.ownership.composer &&
        composer.value === '' &&
        (!options.imageName ||
          !composerHasImage(composer, options.imageName)) &&
        options.ownership.isUnaltered()
      ) {
        return matching[0];
      }
      return undefined;
    },
  });
}

/**
 * @param {{
 *   document: Document,
 *   signal: AbortSignal,
 *   expectedSessionId: string,
 *   getSessionId: () => string | null,
 *   baseline: import('./messages.js').MessageSnapshot[],
 *   confirmedUser: import('./messages.js').MessageSnapshot,
 *   pollIntervalMs: number,
 * }} options
 */
export function waitForAssistant(options) {
  return waitForPageCondition({
    ...options,
    check() {
      assertSession(
        options.getSessionId,
        options.expectedSessionId,
        'awaiting_response',
      );
      const current = snapshotMessages(options.document);
      const userIndex = messageSnapshotIndex(current, options.confirmedUser);
      if (userIndex < 0) {
        return undefined;
      }
      for (const message of current.slice(userIndex + 1)) {
        if (message.role === 'user') {
          throw new AdapterError(
            ERROR_CODES.RESPONSE_UNCERTAIN,
            'A later user message prevents reliable assistant association',
            {
              stage: 'awaiting_response',
              delivery: 'confirmed',
              retryable: false,
            },
          );
        }
        if (message.role === 'assistant') {
          return message;
        }
      }
      return undefined;
    },
  });
}

/**
 * @param {{
 *   document: Document,
 *   signal: AbortSignal,
 *   expectedSessionId: string,
 *   getSessionId: () => string | null,
 *   baseline: import('./messages.js').MessageSnapshot[],
 *   confirmedUser: import('./messages.js').MessageSnapshot,
 *   assistant: import('./messages.js').MessageSnapshot,
 *   pollIntervalMs: number,
 *   stabilityMs: number,
 *   now: () => number,
 * }} options
 */
export function waitForResponseCompletion(options) {
  let fingerprint = '';
  let stableSince = options.now();

  return waitForPageCondition({
    ...options,
    nextDelay() {
      const stabilityRemaining =
        options.stabilityMs - (options.now() - stableSince);
      return stabilityRemaining > 0
        ? Math.min(options.pollIntervalMs, stabilityRemaining)
        : options.pollIntervalMs;
    },
    check() {
      assertSession(
        options.getSessionId,
        options.expectedSessionId,
        'generating',
      );
      const current = snapshotMessages(options.document);
      const userIndex = messageSnapshotIndex(current, options.confirmedUser);
      if (userIndex < 0) {
        return undefined;
      }
      const afterUser = current.slice(userIndex + 1);
      const assistant = afterUser.find(
        (message) => message.role === 'assistant',
      );
      if (!assistant) {
        return undefined;
      }
      if (afterUser.some((message) => message.role === 'user')) {
        throw new AdapterError(
          ERROR_CODES.RESPONSE_UNCERTAIN,
          'A later user message prevents reliable response completion',
          {
            stage: 'generating',
            delivery: 'confirmed',
            retryable: false,
          },
        );
      }
      const item = resolveMessageItem(options.document, assistant);
      const formal = item?.querySelector(SELECTORS.assistantContent);
      if (!item || !formal) {
        return undefined;
      }
      if (visibleText(item).includes('继续生成')) {
        throw new AdapterError(
          ERROR_CODES.RESPONSE_INTERRUPTED,
          'DeepSeek response was interrupted',
          {
            stage: 'generating',
            delivery: 'confirmed',
            remoteState: 'interrupted',
            retryable: false,
          },
        );
      }

      const nextFingerprint = normalizeMessageText(formal.textContent ?? '');
      if (nextFingerprint !== fingerprint) {
        fingerprint = nextFingerprint;
        stableSince = options.now();
      }
      const complete =
        Boolean(nextFingerprint) &&
        Boolean(findOperationBar(item)) &&
        mainControlState(getMainControl(options.document)) !== 'stop' &&
        options.now() - stableSince >= options.stabilityMs;
      return complete ? formal : undefined;
    },
  });
}

/**
 * Wait for DOM or periodic URL/control changes. A successful condition is
 * always established by check(), never by elapsed time alone.
 *
 * @template T
 * @param {{
 *   document: Document,
 *   signal: AbortSignal,
 *   pollIntervalMs: number,
 *   check: () => T | undefined,
 *   nextDelay?: () => number,
 * }} options
 * @returns {Promise<T>}
 */
function waitForPageCondition(options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const view = options.document.defaultView;
    const MutationObserverClass = view?.MutationObserver;

    const cleanup = () => {
      observer?.disconnect();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      options.signal.removeEventListener('abort', onAbort);
    };
    /** @param {T} value */
    const resolveOnce = (value) => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(value);
      }
    };
    /** @param {unknown} error */
    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const onAbort = () => rejectOnce(options.signal.reason);
    const schedule = () => {
      if (settled) {
        return;
      }
      const delay = Math.max(
        0,
        options.nextDelay?.() ?? options.pollIntervalMs,
      );
      timer = setTimeout(check, delay);
    };
    const check = () => {
      if (settled) {
        return;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      try {
        const value = options.check();
        if (value !== undefined) {
          resolveOnce(value);
          return;
        }
        schedule();
      } catch (error) {
        rejectOnce(error);
      }
    };
    const observer = MutationObserverClass
      ? new MutationObserverClass(check)
      : null;

    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) {
      onAbort();
      return;
    }
    observer?.observe(options.document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'd', 'aria-pressed', 'aria-disabled'],
    });
    check();
  });
}

/**
 * @param {() => string | null} getSessionId
 * @param {string} expectedSessionId
 * @param {string} stage
 */
function assertSession(getSessionId, expectedSessionId, stage) {
  const actualSessionId = getSessionId();
  if (actualSessionId !== expectedSessionId) {
    throw new AdapterError(
      ERROR_CODES.PAGE_NAVIGATED,
      'DeepSeek session changed while a request was active',
      {
        stage,
        retryable: false,
        diagnostics: { expectedSessionId, actualSessionId },
      },
    );
  }
}
