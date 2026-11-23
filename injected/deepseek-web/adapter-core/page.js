/* eslint-disable no-restricted-imports -- synchronized upstream module graph keeps relative imports */
import { parseSessionId } from './contracts.js';
import { AdapterError, ERROR_CODES } from './errors.js';
import {
  clickSend,
  configureOptions,
  requireEmptyComposer,
  setComposerText,
  watchComposerOwnership,
} from './page/composer.js';
import { extractFormalAnswer } from './page/extract.js';
import { preparePng } from './page/attachments.js';
import { getComposerRegion } from './page/selectors.js';
import { snapshotMessages } from './page/messages.js';
import {
  getComposer,
  getMainControl,
  getToggleControls,
  getVirtualList,
  mainControlState,
  toggleState,
} from './page/selectors.js';
import {
  waitForAssistant,
  waitForResponseCompletion,
  waitForSendConfirmation,
} from './page/response.js';

export class PageDriver {
  /**
   * @param {{
   *   document?: Document,
   *   window?: Window,
   *   now?: () => number,
   *   pollIntervalMs?: number,
   *   stabilityMs?: number,
   * }} [options]
   */
  constructor(options = {}) {
    const defaultWindow = typeof window === 'undefined' ? undefined : window;
    this.window = options.window ?? defaultWindow;
    this.document = options.document ?? this.window?.document;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.stabilityMs = options.stabilityMs ?? 1_200;
  }

  initialize() {
    const document = this.requireDocument();
    const sessionId = this.getSessionId();
    const hostname = this.window?.location.hostname;
    if (hostname !== 'chat.deepseek.com' || !sessionId) {
      throw new AdapterError(
        ERROR_CODES.NOT_AUTHENTICATED,
        'Open an existing DeepSeek UUID chat session before initializing',
        {
          stage: 'initializing',
          retryable: true,
          diagnostics: { pathname: this.window?.location.pathname ?? '' },
        },
      );
    }

    const composer = getComposer(document);
    const list = getVirtualList(document);
    const control = getMainControl(document);
    const toggles = getToggleControls(document);
    if (
      !composer ||
      !list ||
      !control ||
      !toggles.thinking ||
      !toggles.webSearch ||
      toggleState(toggles.thinking) === null ||
      toggleState(toggles.webSearch) === null
    ) {
      throw new AdapterError(
        ERROR_CODES.PAGE_NOT_READY,
        'Required DeepSeek chat controls are unavailable',
        {
          stage: 'initializing',
          retryable: true,
          diagnostics: {
            pathname: this.window?.location.pathname ?? '',
            readyState: document.readyState,
          },
        },
      );
    }
    if (mainControlState(control) === 'stop') {
      throw new AdapterError(
        ERROR_CODES.BUSY,
        'DeepSeek is already generating',
        {
          stage: 'initializing',
          retryable: true,
        },
      );
    }
    requireEmptyComposer(document);
    return { sessionId };
  }

  getSessionId() {
    return parseSessionId(this.window?.location.pathname);
  }

  getCapabilities() {
    const document = this.requireDocument();
    const toggles = getToggleControls(document);
    return {
      text: true,
      image: Boolean(
        getComposer(document) &&
        getComposerRegion(
          /** @type {HTMLTextAreaElement} */ (getComposer(document)),
        )?.querySelector('input[type="file"]') &&
        document.defaultView?.DataTransfer,
      ),
      file: false,
      thinking: Boolean(toggles.thinking),
      webSearch: Boolean(toggles.webSearch),
    };
  }

  /** @param {string} expectedSessionId */
  checkReady(expectedSessionId) {
    this.assertSession(expectedSessionId, 'checking_page');
    const document = this.requireDocument();
    const controlState = mainControlState(getMainControl(document));
    if (controlState === 'stop') {
      throw new AdapterError(
        ERROR_CODES.BUSY,
        'DeepSeek is already generating',
        {
          stage: 'checking_page',
          retryable: true,
        },
      );
    }
    if (!['send', 'disabled'].includes(controlState)) {
      throw new AdapterError(
        ERROR_CODES.PAGE_NOT_READY,
        'DeepSeek send control is unavailable or ambiguous',
        { stage: 'checking_page', retryable: true },
      );
    }
    return requireEmptyComposer(document);
  }

  /**
   * @param {{ thinking?: boolean, webSearch?: boolean }} options
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   */
  configureOptions(options, signal) {
    return configureOptions(this.requireDocument(), options, signal);
  }

  /**
   * @param {HTMLTextAreaElement} composer
   * @param {string} preparedText
   */
  watchComposer(composer, preparedText) {
    return watchComposerOwnership(composer, preparedText);
  }

  /**
   * @param {HTMLTextAreaElement} composer
   * @param {string} text
   * @param {import('./contracts.js').PngInput | undefined} image
   * @param {AbortSignal} signal
   * @param {string} sessionId
   */
  async prepareInput(composer, text, image, signal, sessionId) {
    if (text) setComposerText(this.requireDocument(), composer, text);
    if (image)
      return preparePng(
        this.requireDocument(),
        composer,
        image,
        signal,
        () => this.getSessionId() === sessionId,
      );
    return undefined;
  }

  takeMessageBaseline() {
    return snapshotMessages(this.requireDocument());
  }

  /** @param {string} expectedSessionId */
  assertSession(expectedSessionId, stage = 'checking_page') {
    const actualSessionId = this.getSessionId();
    if (actualSessionId !== expectedSessionId) {
      throw new AdapterError(
        ERROR_CODES.SESSION_MISMATCH,
        'Request session does not match the current DeepSeek session',
        {
          stage,
          retryable: false,
          diagnostics: { expectedSessionId, actualSessionId },
        },
      );
    }
  }

  /** @param {HTMLTextAreaElement} composer @param {string} [imageName] */
  send(composer, imageName) {
    clickSend(this.requireDocument(), composer, imageName);
  }

  /**
   * @param {AbortSignal} signal
   * @param {string} sessionId
   * @param {import('./page/messages.js').MessageSnapshot[]} baseline
   * @param {string} expectedText
   * @param {{ composer: HTMLTextAreaElement, isUnaltered: () => boolean }} ownership
   * @param {string} [imageName]
   */
  confirmSend(signal, sessionId, baseline, expectedText, ownership, imageName) {
    return waitForSendConfirmation({
      document: this.requireDocument(),
      signal,
      expectedSessionId: sessionId,
      getSessionId: () => this.getSessionId(),
      baseline,
      expectedText,
      imageName,
      ownership,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * @param {AbortSignal} signal
   * @param {string} sessionId
   * @param {import('./page/messages.js').MessageSnapshot[]} baseline
   * @param {import('./page/messages.js').MessageSnapshot} confirmedUser
   */
  waitForAssistant(signal, sessionId, baseline, confirmedUser) {
    return waitForAssistant({
      document: this.requireDocument(),
      signal,
      expectedSessionId: sessionId,
      getSessionId: () => this.getSessionId(),
      baseline,
      confirmedUser,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * @param {AbortSignal} signal
   * @param {string} sessionId
   * @param {import('./page/messages.js').MessageSnapshot[]} baseline
   * @param {import('./page/messages.js').MessageSnapshot} confirmedUser
   * @param {import('./page/messages.js').MessageSnapshot} assistant
   */
  waitForCompletion(signal, sessionId, baseline, confirmedUser, assistant) {
    return waitForResponseCompletion({
      document: this.requireDocument(),
      signal,
      expectedSessionId: sessionId,
      getSessionId: () => this.getSessionId(),
      baseline,
      confirmedUser,
      assistant,
      pollIntervalMs: this.pollIntervalMs,
      stabilityMs: this.stabilityMs,
      now: this.now,
    });
  }

  /** @param {Element} formalContent */
  extract(formalContent) {
    return extractFormalAnswer(formalContent);
  }

  /**
   * Click stop only while the request still owns an empty composer in the same
   * session. Returning false means no remote-stop claim can be made.
   *
   * @param {string} sessionId
   * @param {{ composer: HTMLTextAreaElement, isUnaltered: () => boolean }} ownership
   */
  canStop(sessionId, ownership) {
    const document = this.requireDocument();
    return (
      this.getSessionId() === sessionId &&
      ownership.isUnaltered() &&
      getComposer(document) === ownership.composer &&
      ownership.composer.value === '' &&
      mainControlState(getMainControl(document)) === 'stop'
    );
  }

  /**
   * @param {string} sessionId
   * @param {{ composer: HTMLTextAreaElement, isUnaltered: () => boolean }} ownership
   */
  async tryStop(sessionId, ownership) {
    const document = this.requireDocument();
    if (!this.canStop(sessionId, ownership)) {
      return false;
    }
    /** @type {HTMLElement} */ (getMainControl(document)).click();
    await Promise.resolve();
    return mainControlState(getMainControl(document)) !== 'stop';
  }

  requireDocument() {
    if (!this.document) {
      throw new AdapterError(
        ERROR_CODES.PAGE_NOT_READY,
        'DeepSeek document is unavailable',
        { stage: 'initializing', retryable: true },
      );
    }
    return this.document;
  }
}
