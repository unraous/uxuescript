import { DeepSeekAdapter } from './adapter.js';
import { AdapterError, ERROR_CODES } from './errors.js';

const INSTANCE_SLOT = Symbol.for('deepseek-web-adapter.instance.v1');

/** @typedef {typeof globalThis & { [INSTANCE_SLOT]?: DeepSeekAdapter }} RegistryHost */

/**
 * @param {import('./adapter.js').AdapterOptions} [options]
 */
export function createRegisteredAdapter(options = {}) {
  const host = /** @type {RegistryHost} */ (globalThis);
  if (host[INSTANCE_SLOT]) {
    throw new AdapterError(
      ERROR_CODES.INSTANCE_EXISTS,
      'A live DeepSeek adapter instance already exists on this page',
      { stage: 'creating', retryable: false },
    );
  }

  /** @type {DeepSeekAdapter} */
  let adapter;
  adapter = new DeepSeekAdapter({
    ...options,
    onDispose: () => {
      if (host[INSTANCE_SLOT] === adapter) {
        delete host[INSTANCE_SLOT];
      }
      options.onDispose?.();
    },
  });
  host[INSTANCE_SLOT] = adapter;
  return adapter;
}

export function getRegisteredAdapter() {
  const host = /** @type {RegistryHost} */ (globalThis);
  return host[INSTANCE_SLOT] ?? null;
}
