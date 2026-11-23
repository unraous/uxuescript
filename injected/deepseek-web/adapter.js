// eslint-disable-next-line no-restricted-imports -- the embedded adapter keeps its relative entry
import * as api from "./adapter-core/index.js";

/** @typedef {typeof globalThis & {DeepSeekWebAdapter?: typeof api}} Host */

export function main() {
  const host = /** @type {Host} */ (globalThis);
  host.DeepSeekWebAdapter = { ...api };
}
