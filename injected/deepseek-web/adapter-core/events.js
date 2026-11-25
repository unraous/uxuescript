import { sanitizeDiagnostics } from './errors.js';

/**
 * Create an isolated event hub with optional initial subscriptions.
 *
 * @param {{
 *   now?: () => number,
 *   toISOString?: (timestamp: number) => string,
 *   onLog?: (event: LogEvent) => void,
 *   onStateChange?: (event: StateChangeEvent) => void,
 *   onSubscriberError?: (error: unknown) => void,
 * }} [options]
 */
export function createEventHub(options = {}) {
  const now = options.now ?? Date.now;
  const toISOString =
    options.toISOString ?? ((timestamp) => new Date(timestamp).toISOString());
  const onSubscriberError = options.onSubscriberError ?? (() => {});
  /** @type {Set<(event: LogEvent) => void>} */
  const logSubscribers = new Set();
  /** @type {Set<(event: StateChangeEvent) => void>} */
  const stateSubscribers = new Set();

  if (options.onLog) {
    logSubscribers.add(options.onLog);
  }
  if (options.onStateChange) {
    stateSubscribers.add(options.onStateChange);
  }

  return {
    /** @param {(event: LogEvent) => void} listener */
    subscribeLog(listener) {
      return subscribe(logSubscribers, listener);
    },
    /** @param {(event: StateChangeEvent) => void} listener */
    subscribeStateChange(listener) {
      return subscribe(stateSubscribers, listener);
    },
    /** @param {LogEventInput} input */
    emitLog(input) {
      const event = createLogEvent(input, now, toISOString);
      emit(logSubscribers, event, onSubscriberError);
      return event;
    },
    /** @param {StateChangeEventInput} input */
    emitStateChange(input) {
      const event = createStateChangeEvent(input, now, toISOString);
      emit(stateSubscribers, event, onSubscriberError);
      return event;
    },
    clear() {
      logSubscribers.clear();
      stateSubscribers.clear();
    },
  };
}

/**
 * @typedef {{
 *   level: string,
 *   event: string,
 *   requestId?: string,
 *   sessionId?: string,
 *   stage?: string,
 *   startedAt?: number,
 *   elapsedMs?: number,
 *   errorCode?: string,
 *   details?: Record<string, unknown>,
 * }} LogEventInput
 * @typedef {{
 *   timestamp: string,
 *   level: string,
 *   event: string,
 *   requestId?: string,
 *   sessionId?: string,
 *   stage?: string,
 *   elapsedMs?: number,
 *   errorCode?: string,
 *   details?: Record<string, unknown>,
 * }} LogEvent
 * @typedef {{
 *   requestId?: string,
 *   sessionId?: string,
 *   previousState?: string,
 *   state: string,
 *   stage?: string,
 *   startedAt?: number,
 *   elapsedMs?: number,
 *   errorCode?: string,
 *   details?: Record<string, unknown>,
 * }} StateChangeEventInput
 * @typedef {{
 *   timestamp: string,
 *   requestId?: string,
 *   sessionId?: string,
 *   previousState?: string,
 *   state: string,
 *   stage?: string,
 *   elapsedMs?: number,
 *   errorCode?: string,
 *   details?: Record<string, unknown>,
 * }} StateChangeEvent
 */

/**
 * @param {LogEventInput} input
 * @param {() => number} [now]
 * @param {(timestamp: number) => string} [toISOString]
 * @returns {LogEvent}
 */
export function createLogEvent(
  input,
  now = Date.now,
  toISOString = (timestamp) => new Date(timestamp).toISOString(),
) {
  const currentTime = now();
  return compact({
    timestamp: toISOString(currentTime),
    level: input.level,
    event: input.event,
    requestId: input.requestId,
    sessionId: input.sessionId,
    stage: input.stage,
    elapsedMs: elapsedMs(input, currentTime),
    errorCode: input.errorCode,
    details: details(input.details),
  });
}

/**
 * @param {StateChangeEventInput} input
 * @param {() => number} [now]
 * @param {(timestamp: number) => string} [toISOString]
 * @returns {StateChangeEvent}
 */
export function createStateChangeEvent(
  input,
  now = Date.now,
  toISOString = (timestamp) => new Date(timestamp).toISOString(),
) {
  const currentTime = now();
  return compact({
    timestamp: toISOString(currentTime),
    requestId: input.requestId,
    sessionId: input.sessionId,
    previousState: input.previousState,
    state: input.state,
    stage: input.stage,
    elapsedMs: elapsedMs(input, currentTime),
    errorCode: input.errorCode,
    details: details(input.details),
  });
}

/**
 * @template T
 * @param {Set<(event: T) => void>} subscribers
 * @param {(event: T) => void} listener
 */
function subscribe(subscribers, listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('Event listener must be a function');
  }
  subscribers.add(listener);
  let active = true;
  return () => {
    if (!active) {
      return false;
    }
    active = false;
    return subscribers.delete(listener);
  };
}

/**
 * @template T
 * @param {Set<(event: T) => void>} subscribers
 * @param {T} event
 * @param {(error: unknown) => void} onSubscriberError
 */
function emit(subscribers, event, onSubscriberError) {
  for (const listener of [...subscribers]) {
    try {
      listener(event);
    } catch (error) {
      try {
        onSubscriberError(error);
      } catch {
        // Subscriber error reporting is isolated from the core flow as well.
      }
    }
  }
}

/**
 * @param {{ startedAt?: number, elapsedMs?: number }} input
 * @param {number} timestamp
 */
function elapsedMs(input, timestamp) {
  if (input.elapsedMs !== undefined) {
    return Math.max(0, input.elapsedMs);
  }
  if (input.startedAt !== undefined) {
    return Math.max(0, timestamp - input.startedAt);
  }
  return undefined;
}

/**
 * @param {Record<string, unknown> | undefined} value
 */
function details(value) {
  if (value === undefined) {
    return undefined;
  }
  const sanitized = sanitizeDiagnostics(value);
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} value
 * @returns {T}
 */
function compact(value) {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}
