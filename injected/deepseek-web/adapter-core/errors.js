export const ERROR_CODES = Object.freeze({
  INSTANCE_EXISTS: 'INSTANCE_EXISTS',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  DISPOSED: 'DISPOSED',
  PAGE_NOT_READY: 'PAGE_NOT_READY',
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  SESSION_MISMATCH: 'SESSION_MISMATCH',
  BUSY: 'BUSY',
  COMPOSER_NOT_EMPTY: 'COMPOSER_NOT_EMPTY',
  UNSUPPORTED_INPUT: 'UNSUPPORTED_INPUT',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  ATTACHMENT_FAILED: 'ATTACHMENT_FAILED',
  SEND_FAILED: 'SEND_FAILED',
  SEND_UNCERTAIN: 'SEND_UNCERTAIN',
  RESPONSE_TIMEOUT: 'RESPONSE_TIMEOUT',
  RESPONSE_INTERRUPTED: 'RESPONSE_INTERRUPTED',
  RESPONSE_UNCERTAIN: 'RESPONSE_UNCERTAIN',
  PAGE_NAVIGATED: 'PAGE_NAVIGATED',
  CANCELLED: 'CANCELLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST',
  ILLEGAL_STATE_TRANSITION: 'ILLEGAL_STATE_TRANSITION',
});

/** @typedef {typeof ERROR_CODES[keyof typeof ERROR_CODES]} ErrorCode */
/** @typedef {'not_sent' | 'unknown' | 'confirmed'} Delivery */

const DIAGNOSTIC_KEYS = new Set([
  'pathname',
  'readyState',
  'candidateCount',
  'delivery',
  'expectedSessionId',
  'actualSessionId',
  'capability',
  'control',
  'reason',
  'state',
  'previousState',
  'timeoutMs',
  'partCount',
  'textLength',
  'responseLength',
  'verification',
  'serverConfirmed',
  'attachmentCount',
  'totalBytes',
]);

export class AdapterError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{
   *   stage?: string,
   *   delivery?: Delivery,
   *   remoteState?: string,
   *   retryable?: boolean,
   *   diagnostics?: Record<string, unknown>,
   *   cause?: unknown,
   * }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AdapterError';
    this.code = code;
    this.stage = options.stage;
    this.delivery = options.delivery;
    this.remoteState = options.remoteState;
    this.retryable = options.retryable ?? false;
    this.diagnostics = sanitizeDiagnostics(options.diagnostics);
  }
}

/**
 * @param {ResultContext} context
 * @param {unknown} error
 * @returns {GenerateResult}
 */
export function createFailureResult(context, error) {
  return createErrorResult('failed', context, error);
}

/**
 * @param {ResultContext} context
 * @param {unknown} error
 * @returns {GenerateResult}
 */
export function createUncertainResult(context, error) {
  return createErrorResult('uncertain', context, error);
}

/**
 * @typedef {{
 *   requestId: string,
 *   sessionId: string,
 *   state: string,
 *   delivery: Delivery,
 *   remoteState: string,
 *   durationMs: number,
 * }} ResultContext
 * @typedef {{
 *   requestId: string,
 *   sessionId: string,
 *   status: 'failed' | 'uncertain',
 *   durationMs: number,
 *   error: {
 *     code: ErrorCode,
 *     message: string,
 *     stage: string,
 *     delivery: Delivery,
 *     remote: string,
 *     retryable: boolean,
 *     diagnostics: Record<string, unknown>,
 *   },
 * }} GenerateResult
 */

/**
 * @param {'failed' | 'uncertain'} status
 * @param {ResultContext} context
 * @param {unknown} error
 * @returns {GenerateResult}
 */
function createErrorResult(status, context, error) {
  const adapterError = toAdapterError(error, context.state);
  const delivery = adapterError.delivery ?? context.delivery;

  return {
    requestId: context.requestId,
    sessionId: context.sessionId,
    status,
    durationMs: context.durationMs,
    error: {
      code: adapterError.code,
      message: adapterError.message,
      stage: adapterError.stage ?? context.state,
      delivery,
      remote: adapterError.remoteState ?? context.remoteState,
      retryable:
        status === 'uncertain' || delivery !== 'not_sent'
          ? false
          : adapterError.retryable,
      diagnostics: sanitizeDiagnostics(adapterError.diagnostics),
    },
  };
}

/**
 * @param {unknown} error
 * @param {string} stage
 * @returns {AdapterError}
 */
function toAdapterError(error, stage) {
  if (error instanceof AdapterError) {
    return error;
  }

  return new AdapterError(
    ERROR_CODES.INTERNAL_ERROR,
    'Internal adapter error',
    {
      stage,
      retryable: false,
      cause: error,
    },
  );
}

/**
 * Keep runtime diagnostics intentionally small and non-sensitive.
 *
 * @param {unknown} diagnostics
 * @returns {Record<string, unknown>}
 */
export function sanitizeDiagnostics(diagnostics) {
  if (
    typeof diagnostics !== 'object' ||
    diagnostics === null ||
    Array.isArray(diagnostics)
  ) {
    return {};
  }

  /** @type {Record<string, unknown>} */
  const sanitized = {};
  for (const [key, value] of Object.entries(diagnostics)) {
    if (DIAGNOSTIC_KEYS.has(key) && isSafeDiagnosticValue(value)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * @param {unknown} value
 */
function isSafeDiagnosticValue(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
