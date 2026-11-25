import { AdapterError, ERROR_CODES } from './errors.js';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 600_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {{ type: 'text', text: string }} TextPart
 * @typedef {{ type: 'image', mimeType: 'image/png', data: string, name?: string }} ImagePart
 * @typedef {{ bytes: Uint8Array, name: string }} PngInput
 * @typedef {{ thinking?: boolean, webSearch?: boolean, timeoutMs?: number }} GenerateOptions
 * @typedef {{
 *   requestId: string,
 *   sessionId: string,
 *   parts: (TextPart | ImagePart)[],
 *   options?: GenerateOptions,
 * }} GenerateRequest
 * @typedef {{
 *   thinking?: boolean,
 *   webSearch?: boolean,
 *   timeoutMs: number,
 * }} NormalizedGenerateOptions
 * @typedef {{
 *   requestId: string,
 *   sessionId: string,
 *   text: string,
 *   image?: PngInput,
 *   options: NormalizedGenerateOptions,
 * }} NormalizedGenerateRequest
 */

/**
 * Validate and normalize the Milestone 1 text-only request contract.
 *
 * @param {unknown} request
 * @returns {NormalizedGenerateRequest}
 */
export function validateGenerateRequest(request) {
  if (!isRecord(request)) {
    throw invalidRequest('Generate request must be an object');
  }

  if (Object.hasOwn(request, 'timeoutMs')) {
    throw invalidRequest('timeoutMs belongs inside options');
  }

  const requestId = request.requestId;
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    throw invalidRequest('requestId must be a nonempty string');
  }

  const sessionId = request.sessionId;
  if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) {
    throw invalidRequest('sessionId must be a UUID string');
  }

  const parts = request.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw invalidRequest('parts must be a nonempty array');
  }

  /** @type {string[]} */
  const textParts = [];
  /** @type {PngInput | undefined} */
  let image;
  for (const part of parts) {
    if (!isRecord(part)) throw invalidRequest('Each part must be an object');
    if (part.type === 'image') {
      if (image)
        throw invalidRequest('Only one PNG image is supported per request');
      image = normalizePng(part);
    } else if (part.type === 'text') {
      if (typeof part.text !== 'string' || part.text.trim().length === 0) {
        throw invalidRequest('Text parts must contain nonempty text');
      }
      textParts.push(part.text);
    } else {
      throw new AdapterError(
        ERROR_CODES.UNSUPPORTED_INPUT,
        'Only text and one PNG image are supported',
        { stage: 'validating' },
      );
    }
  }

  const options = normalizeOptions(request.options);
  const normalized = {
    requestId,
    sessionId: sessionId.toLowerCase(),
    text: textParts.join('\n\n'),
    options,
  };
  return image ? { ...normalized, image } : normalized;
}

/** @param {Record<string, unknown>} part @returns {PngInput} */
function normalizePng(part) {
  if (part.mimeType !== 'image/png') {
    throw new AdapterError(
      ERROR_CODES.UNSUPPORTED_INPUT,
      'Only image/png is supported',
      { stage: 'validating' },
    );
  }
  const data = part.data;
  if (
    typeof data !== 'string' ||
    !data.length ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  ) {
    throw invalidRequest(
      'Image data must be raw, padded Base64 without a data URL prefix',
    );
  }
  const binary = atob(data);
  if (btoa(binary) !== data)
    throw invalidRequest('Image data is not canonical Base64');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw invalidRequest('Image data does not have a PNG signature');
  }
  if (
    part.name !== undefined &&
    (typeof part.name !== 'string' || !part.name.endsWith('.png'))
  ) {
    throw invalidRequest('Image name must end with .png');
  }
  return {
    bytes,
    name: typeof part.name === 'string' ? part.name : 'image.png',
  };
}

/**
 * Parse a session ID from a DeepSeek session pathname.
 *
 * @param {unknown} pathname
 * @returns {string | null}
 */
export function parseSessionId(pathname) {
  if (typeof pathname !== 'string') {
    return null;
  }

  const match = /^\/a\/chat\/s\/([^/]+)\/?$/.exec(pathname);
  if (!match || !UUID_PATTERN.test(match[1])) {
    return null;
  }

  return match[1].toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {NormalizedGenerateOptions}
 */
function normalizeOptions(value) {
  if (value === undefined) {
    return { timeoutMs: DEFAULT_TIMEOUT_MS };
  }
  if (!isRecord(value)) {
    throw invalidRequest('options must be an object when present');
  }

  /** @type {NormalizedGenerateOptions} */
  const options = { timeoutMs: DEFAULT_TIMEOUT_MS };
  for (const key of /** @type {const} */ (['thinking', 'webSearch'])) {
    const option = value[key];
    if (option !== undefined && typeof option !== 'boolean') {
      throw invalidRequest(`options.${key} must be a boolean when present`);
    }
    if (option !== undefined) {
      options[key] = /** @type {boolean} */ (option);
    }
  }

  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== undefined) {
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isFinite(timeoutMs) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < MIN_TIMEOUT_MS ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw invalidRequest(
        `options.timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      );
    }
    options.timeoutMs = timeoutMs;
  }
  return options;
}

/**
 * @param {string} message
 */
function invalidRequest(message) {
  return new AdapterError(ERROR_CODES.INVALID_REQUEST, message, {
    stage: 'validating',
    retryable: false,
  });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
