const COMPOSER_SELECTOR = 'textarea[name="search"]';
const VIRTUAL_LIST_SELECTOR = '.ds-virtual-list';
const MESSAGE_ITEM_SELECTOR = '[data-virtual-list-item-key]';
const MESSAGE_SELECTOR = '.ds-message';
const ASSISTANT_CONTENT_SELECTOR = '.ds-assistant-message-main-content';
const THINK_CONTENT_SELECTOR = '.ds-think-content';
const TOGGLE_SELECTOR = 'div.ds-toggle-button';
const MAIN_BUTTON_SELECTOR =
  '[role="button"].ds-button--circle.ds-button--primary:not(.ds-button--floating)';

const SEND_PATH_PREFIX = 'M8.3125 0.980206';
const STOP_PATH_PREFIX = 'M2 4.88';

export const SELECTORS = Object.freeze({
  composer: COMPOSER_SELECTOR,
  virtualList: VIRTUAL_LIST_SELECTOR,
  messageItem: MESSAGE_ITEM_SELECTOR,
  message: MESSAGE_SELECTOR,
  assistantContent: ASSISTANT_CONTENT_SELECTOR,
  thinkContent: THINK_CONTENT_SELECTOR,
});

/** @param {Document} document */
export function getComposer(document) {
  const composer = document.querySelector(COMPOSER_SELECTOR);
  const TextArea = document.defaultView?.HTMLTextAreaElement;
  return TextArea && composer instanceof TextArea ? composer : null;
}

/** @param {Document} document */
export function getVirtualList(document) {
  return document.querySelector(VIRTUAL_LIST_SELECTOR);
}

/** @param {Document} document */
export function getMainControl(document) {
  const controls = [...document.querySelectorAll(MAIN_BUTTON_SELECTOR)];
  return controls.length === 1 ? controls[0] : null;
}

/**
 * @param {Element | null} control
 * @returns {'send' | 'stop' | 'disabled' | 'unknown' | 'missing'}
 */
export function mainControlState(control) {
  if (!control) {
    return 'missing';
  }
  if (
    control.classList.contains('ds-button--disabled') ||
    control.getAttribute('aria-disabled') === 'true'
  ) {
    return 'disabled';
  }

  const paths = [...control.querySelectorAll('path')]
    .map((path) => path.getAttribute('d')?.trim() ?? '')
    .filter(Boolean);
  if (paths.some((path) => path.startsWith(STOP_PATH_PREFIX))) {
    return 'stop';
  }
  if (paths.some((path) => path.startsWith(SEND_PATH_PREFIX))) {
    return 'send';
  }
  return 'unknown';
}

/**
 * @param {Document} document
 * @returns {{ thinking: Element | null, webSearch: Element | null }}
 */
export function getToggleControls(document) {
  const toggles = [...document.querySelectorAll(TOGGLE_SELECTOR)];
  return {
    thinking:
      toggles.find((toggle) => visibleText(toggle).includes('深度思考')) ??
      null,
    webSearch:
      toggles.find((toggle) => visibleText(toggle).includes('智能搜索')) ??
      null,
  };
}

/** @param {Element} toggle */
export function toggleState(toggle) {
  const value = toggle.getAttribute('aria-pressed');
  return value === 'true' ? true : value === 'false' ? false : null;
}

/** @param {HTMLTextAreaElement} composer */
export function getComposerRegion(composer) {
  const form = composer.closest('form');
  if (form) return form;
  // The upload input lives beside the text area; image cards are in its parent panel.
  for (
    let region = composer.parentElement;
    region;
    region = region.parentElement
  ) {
    if (region.querySelector('input[type="file"]'))
      return region.parentElement ?? region;
  }
  return composer.parentElement;
}

/** @param {HTMLTextAreaElement} composer */
export function hasAttachmentNearComposer(composer) {
  const region = getComposerRegion(composer);
  return Boolean(
    region?.querySelector(
      'img[alt], [data-file-id], [data-attachment-id], .ds-attachment, .ds-file-card',
    ),
  );
}

/** @param {Element} item */
export function findOperationBar(item) {
  const formal = item.querySelector(ASSISTANT_CONTENT_SELECTOR);
  for (const candidate of item.querySelectorAll(
    '[data-ds-operation-bar], div.ds-flex',
  )) {
    if (
      !formal?.contains(candidate) &&
      !candidate.closest(THINK_CONTENT_SELECTOR)
    ) {
      return candidate;
    }
  }
  return null;
}

/** @param {Element} element */
export function visibleText(element) {
  const htmlElement = /** @type {HTMLElement} */ (element);
  return (htmlElement.innerText ?? element.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
}
