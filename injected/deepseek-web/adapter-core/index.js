import { createRegisteredAdapter, getRegisteredAdapter } from './registry.js';

export const VERSION = '0.1.0';

/**
 * Create the one live adapter allowed on the current page.
 *
 * @param {import('./adapter.js').AdapterOptions} [options]
 */
export function createDeepSeekAdapter(options = {}) {
  return createRegisteredAdapter(options);
}

/**
 * Get the current live page adapter, if one exists.
 */
export function getDeepSeekAdapterInstance() {
  return getRegisteredAdapter();
}
