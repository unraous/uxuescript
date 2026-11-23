import { SELECTORS, visibleText } from './selectors.js';

/** @typedef {'user' | 'assistant'} MessageRole */
/**
 * @typedef {{
 *   role: MessageRole,
 *   text: string,
 *   signature: string,
 *   occurrence: number,
 *   imageNames: string[],
 * }} MessageSnapshot
 */

/** @param {unknown} value */
export function normalizeMessageText(value) {
  return typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .replace(/[\t \f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : '';
}

/**
 * Snapshot the visible semantic sequence. Item keys are intentionally ignored
 * because DeepSeek can replace them during virtual-list rerenders.
 *
 * @param {Document} document
 * @returns {MessageSnapshot[]}
 */
export function snapshotMessages(document) {
  const list = document.querySelector(SELECTORS.virtualList);
  if (!list) {
    return [];
  }

  /** @type {Map<string, number>} */
  const occurrences = new Map();
  /** @type {MessageSnapshot[]} */
  const messages = [];
  for (const item of list.querySelectorAll(SELECTORS.messageItem)) {
    const message = item.querySelector(SELECTORS.message);
    if (!message || !isVisible(item)) {
      continue;
    }
    const formal = message.querySelector(SELECTORS.assistantContent);
    const userContent = message.querySelector('.ds-collapsible-text');
    const imageNames = formal
      ? []
      : [...item.querySelectorAll('img[alt]')]
          .map((img) => img.getAttribute('alt') ?? '')
          .filter(Boolean);
    if (!formal && !userContent && !imageNames.length) {
      continue;
    }
    const role = formal ? 'assistant' : 'user';
    const source = formal ?? userContent;
    const text = normalizeMessageText(source ? visibleText(source) : '');
    const signature = `${role}:${text}${imageNames.length ? `:images:${imageNames.join('|')}` : ''}`;
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    messages.push({ role, text, signature, occurrence, imageNames });
  }
  return messages;
}

/**
 * @param {MessageSnapshot[]} baseline
 * @param {MessageSnapshot[]} current
 */
export function newMessageSuffix(baseline, current) {
  if (baseline.length === 0) {
    return current;
  }

  const baselineSignatures = baseline.map(({ signature }) => signature);
  const currentSignatures = current.map(({ signature }) => signature);
  const maxOverlap = Math.min(baseline.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const baselineStart = baselineSignatures.length - overlap;
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (
        baselineSignatures[baselineStart + index] !== currentSignatures[index]
      ) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return current.slice(overlap);
    }
  }
  return null;
}

/**
 * @param {MessageSnapshot[]} messages
 * @param {MessageSnapshot} target
 */
export function messageSnapshotIndex(messages, target) {
  return messages.findIndex(
    (message) =>
      message.signature === target.signature &&
      message.occurrence === target.occurrence,
  );
}

/**
 * @param {Document} document
 * @param {MessageSnapshot} snapshot
 */
export function resolveMessageItem(document, snapshot) {
  const list = document.querySelector(SELECTORS.virtualList);
  if (!list) {
    return null;
  }

  let occurrence = 0;
  for (const item of list.querySelectorAll(SELECTORS.messageItem)) {
    const message = item.querySelector(SELECTORS.message);
    if (!message || !isVisible(item)) {
      continue;
    }
    const formal = message.querySelector(SELECTORS.assistantContent);
    const userContent = message.querySelector('.ds-collapsible-text');
    const imageNames = formal
      ? []
      : [...item.querySelectorAll('img[alt]')]
          .map((img) => img.getAttribute('alt') ?? '')
          .filter(Boolean);
    if (!formal && !userContent && !imageNames.length) {
      continue;
    }
    const role = formal ? 'assistant' : 'user';
    const source = formal ?? userContent;
    const signature = `${role}:${normalizeMessageText(source ? visibleText(source) : '')}${imageNames.length ? `:images:${imageNames.join('|')}` : ''}`;
    if (signature !== snapshot.signature) {
      continue;
    }
    if (occurrence === snapshot.occurrence) {
      return item;
    }
    occurrence += 1;
  }
  return null;
}

/** @param {Element} element */
function isVisible(element) {
  return !element.closest('[hidden], [aria-hidden="true"]');
}
