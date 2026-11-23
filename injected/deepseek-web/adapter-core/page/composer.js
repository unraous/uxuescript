/* eslint-disable no-restricted-imports -- synchronized upstream module graph keeps relative imports */
import { AdapterError, ERROR_CODES } from '../errors.js';
import { composerHasImage } from './attachments.js';
import {
  getComposer,
  getMainControl,
  getToggleControls,
  hasAttachmentNearComposer,
  mainControlState,
  toggleState,
} from './selectors.js';

/**
 * @param {Document} document
 * @returns {HTMLTextAreaElement}
 */
export function requireEmptyComposer(document) {
  const composer = getComposer(document);
  if (!composer) {
    throw new AdapterError(
      ERROR_CODES.PAGE_NOT_READY,
      'DeepSeek composer is not available',
      { stage: 'checking_page', retryable: true },
    );
  }
  if (composer.value.length > 0 || hasAttachmentNearComposer(composer)) {
    throw new AdapterError(
      ERROR_CODES.COMPOSER_NOT_EMPTY,
      'Composer contains existing text or an attachment',
      { stage: 'checking_page', retryable: false },
    );
  }
  return composer;
}

const TOGGLE_POLL_INTERVAL_MS = 50;
const TOGGLE_STATE_TIMEOUT_MS = 2_950;

/**
 * @param {Document} document
 * @param {{ thinking?: boolean, webSearch?: boolean }} options
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function configureOptions(document, options, signal) {
  await configureToggle(document, options.thinking, 'thinking', signal);
  await configureToggle(document, options.webSearch, 'webSearch', signal);
}

/**
 * @param {Document} document
 * @param {HTMLTextAreaElement} composer
 * @param {string} text
 */
export function setComposerText(document, composer, text) {
  if (getComposer(document) !== composer || composer.value.length > 0) {
    throw new AdapterError(
      ERROR_CODES.COMPOSER_NOT_EMPTY,
      'Composer ownership changed before input preparation',
      { stage: 'preparing_input', retryable: false },
    );
  }

  const view = document.defaultView;
  if (!view) {
    throw new AdapterError(
      ERROR_CODES.PAGE_NOT_READY,
      'Composer window is unavailable',
      { stage: 'preparing_input', retryable: true },
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    view.HTMLTextAreaElement.prototype,
    'value',
  );
  descriptor?.set?.call(composer, text);
  composer.dispatchEvent(new view.Event('input', { bubbles: true }));
  if (composer.value !== text) {
    throw new AdapterError(
      ERROR_CODES.SEND_FAILED,
      'DeepSeek did not accept the prepared input',
      { stage: 'preparing_input', retryable: true },
    );
  }
}

/**
 * @param {HTMLTextAreaElement} composer
 * @param {string} preparedText
 */
export function watchComposerOwnership(composer, preparedText) {
  let cleared = false;
  let altered = false;
  const onInput = () => {
    if (!cleared && composer.value === preparedText) {
      return;
    }
    if (!cleared && composer.value === '') {
      cleared = true;
      return;
    }
    if (cleared && composer.value === '') {
      return;
    }
    altered = true;
  };
  composer.addEventListener('input', onInput);
  return {
    composer,
    isUnaltered() {
      return !altered;
    },
    dispose() {
      composer.removeEventListener('input', onInput);
    },
  };
}

/**
 * @param {Document} document
 * @param {HTMLTextAreaElement} composer
 * @param {string} [imageName]
 */
export function clickSend(document, composer, imageName) {
  if (
    getComposer(document) !== composer ||
    (!imageName && composer.value.length === 0) ||
    (imageName && !composerHasImage(composer, imageName))
  ) {
    throw new AdapterError(
      ERROR_CODES.SEND_FAILED,
      'Prepared input is no longer owned by the adapter',
      { stage: 'send_attempted', retryable: false },
    );
  }
  const control = getMainControl(document);
  if (mainControlState(control) !== 'send') {
    throw new AdapterError(
      ERROR_CODES.SEND_FAILED,
      'DeepSeek send control is not actionable',
      { stage: 'send_attempted', retryable: false },
    );
  }
  /** @type {HTMLElement} */ (control).click();
}

/**
 * @param {Document} document
 * @param {boolean | undefined} requested
 * @param {'thinking' | 'webSearch'} capability
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
async function configureToggle(document, requested, capability, signal) {
  if (requested === undefined) {
    return;
  }

  const control = getToggleControls(document)[capability];
  if (!control || toggleState(control) === null) {
    throw capabilityUnavailable(
      capability,
      `DeepSeek ${capability} control is unavailable`,
    );
  }
  if (toggleState(control) === requested) {
    return;
  }

  /** @type {HTMLElement} */ (control).click();
  await waitForToggleState(document, capability, requested, signal);
}

/**
 * @param {Document} document
 * @param {'thinking' | 'webSearch'} capability
 * @param {boolean} requested
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function waitForToggleState(document, capability, requested, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const MutationObserverClass = document.defaultView?.MutationObserver;
    /** @type {MutationObserver | null} */
    let observer = null;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let pollTimer;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutTimer;

    const cleanup = () => {
      observer?.disconnect();
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
      }
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
      signal?.removeEventListener('abort', onAbort);
    };
    const resolveOnce = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
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
    const check = () => {
      const liveControl = getToggleControls(document)[capability];
      if (liveControl && toggleState(liveControl) === requested) {
        resolveOnce();
      }
    };
    const onAbort = () => rejectOnce(signal?.reason);
    const onTimeout = () =>
      rejectOnce(
        capabilityUnavailable(
          capability,
          `DeepSeek ${capability} control did not reach the requested state`,
        ),
      );

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    observer = MutationObserverClass ? new MutationObserverClass(check) : null;
    observer?.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
    pollTimer = setInterval(check, TOGGLE_POLL_INTERVAL_MS);
    timeoutTimer = setTimeout(onTimeout, TOGGLE_STATE_TIMEOUT_MS);
    check();
  });
}

/**
 * @param {string} capability
 * @param {string} message
 */
function capabilityUnavailable(capability, message) {
  return new AdapterError(ERROR_CODES.CAPABILITY_UNAVAILABLE, message, {
    stage: 'configuring_options',
    retryable: false,
    diagnostics: { capability },
  });
}
