/* eslint-disable no-restricted-imports -- synchronized upstream module graph keeps relative imports */
import { AdapterError, ERROR_CODES } from '../errors.js';
import {
  getComposerRegion,
  getMainControl,
  mainControlState,
} from './selectors.js';

/** @typedef {{ name: string, remove: () => void }} PreparedImage */

/**
 * Mount one PNG through the page's own file input. Readiness is page-inferred:
 * a decodable preview, no active percentage indicator, and an actionable send
 * control. Stability only supplements these signals; no server API is read.
 *
 * @param {Document} document
 * @param {HTMLTextAreaElement} composer
 * @param {import('../contracts.js').PngInput} image
 * @param {AbortSignal} signal
 * @param {() => boolean} sessionMatches
 * @returns {Promise<PreparedImage>}
 */
export async function preparePng(
  document,
  composer,
  image,
  signal,
  sessionMatches,
) {
  const region = getComposerRegion(composer);
  const view = document.defaultView;
  const input = region?.querySelector('input[type="file"]');
  if (
    !region ||
    !view ||
    !(input instanceof view.HTMLInputElement) ||
    !view.DataTransfer
  ) {
    throw attachmentError('The page PNG upload input is unavailable');
  }
  const name = `ds-adapter-${view.crypto.randomUUID()}.png`;
  const expectedText = composer.value;
  const findImage = () =>
    /** @type {HTMLImageElement | undefined} */ (
      [...region.querySelectorAll('img')].find((img) => img.alt === name)
    );
  const remove = () => {
    if (!sessionMatches()) return;
    const card = findImage()?.closest('[role="button"]');
    const path = card?.querySelector('path[d^="M10.6074"]');
    const control = path?.closest('[tabindex="0"]');
    if (control && control !== card)
      /** @type {HTMLElement} */ (control).click();
  };
  const file = new view.File([new Uint8Array(image.bytes).buffer], name, {
    type: 'image/png',
  });
  const transfer = new view.DataTransfer();
  transfer.items.add(file);

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      let stableSince = 0;
      let fingerprint = '';
      const check = () => {
        if (settled) return;
        if (!sessionMatches())
          return fail(
            new AdapterError(
              ERROR_CODES.PAGE_NAVIGATED,
              'Session changed during PNG preparation',
              { stage: 'preparing_input' },
            ),
          );
        if (composer.value !== expectedText)
          return fail(
            attachmentError('Composer changed during PNG preparation'),
          );
        const img = findImage();
        const card = img?.closest('[role="button"]');
        if (card && /上传失败|解析失败/.test(card.textContent ?? ''))
          return fail(
            attachmentError('The page reported a PNG upload failure'),
          );
        const progress = card?.querySelector('[role="img"][aria-label$="%"]');
        const ready = Boolean(
          img?.complete &&
          img.naturalWidth > 0 &&
          card &&
          !progress &&
          mainControlState(getMainControl(document)) === 'send',
        );
        const next = ready ? `${img?.src}:${card?.textContent}` : '';
        if (!next || next !== fingerprint) {
          fingerprint = next;
          stableSince = Date.now();
        }
        if (ready && Date.now() - stableSince >= 500) succeed();
      };
      const cleanup = () => {
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timeout);
        signal.removeEventListener('abort', aborted);
        region.removeEventListener('error', previewFailed, true);
      };
      const succeed = () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(undefined);
        }
      };
      /** @param {unknown} error */
      const fail = (error) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      };
      const aborted = () => fail(signal.reason);
      /** @param {Event} event */
      const previewFailed = (event) => {
        if (event.target === findImage())
          fail(attachmentError('PNG preview could not be decoded'));
      };
      const observer = new view.MutationObserver(check);
      const poll = setInterval(check, 100);
      const timeout = setTimeout(
        () =>
          fail(
            attachmentError(
              'PNG preparation did not reach page-inferred readiness',
            ),
          ),
        30_000,
      );
      observer.observe(region, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      signal.addEventListener('abort', aborted, { once: true });
      region.addEventListener('error', previewFailed, true);
      if (signal.aborted) {
        aborted();
        return;
      }
      // Setting files alone is not evidence of readiness: React clears it after change.
      try {
        input.files = transfer.files;
        input.dispatchEvent(new view.Event('change', { bubbles: true }));
        check();
      } catch (error) {
        fail(attachmentError('The page could not accept the PNG', error));
      }
    });
    return { name, remove };
  } catch (error) {
    remove();
    throw error;
  }
}

/** @param {string} message @param {unknown} [cause] */
function attachmentError(message, cause) {
  return new AdapterError(ERROR_CODES.ATTACHMENT_FAILED, message, {
    stage: 'preparing_input',
    delivery: 'not_sent',
    retryable: false,
    cause,
  });
}

/** @param {HTMLTextAreaElement} composer @param {string} name */
export function composerHasImage(composer, name) {
  return Boolean(
    [...(getComposerRegion(composer)?.querySelectorAll('img') ?? [])].some(
      (img) => img.alt === name,
    ),
  );
}
