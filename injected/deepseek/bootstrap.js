import { wait } from "@injected/utils/async.js";

/**
 * @typedef {{initialize(): Promise<void>, getSession(): {id: string}|null, dispose(): Promise<void>}} Adapter
 * @typedef {{VERSION: string, createDeepSeekAdapter(): Adapter, getDeepSeekAdapterInstance(): Adapter|null}} AdapterApi
 * @typedef {"waiting_path"|"initializing"|"waiting_page"|"ready"|"invalidated"|"disposing"|"failed"|"destroyed"} Phase
 * @typedef {"not_started"|"pending"|"fulfilled"|"rejected"} Initialization
 * @typedef {{schemaVersion: number, generation: number, apiAvailable: boolean, adapterVersion: string|null, phase: Phase, initialization: Initialization, attempts: number, pathBindable: boolean, sessionPresent: boolean, sessionState: "none"|"valid"|"invalid"|"unbound", errorCode: string|null, pageNotReadyTimedOut: boolean}} Snapshot
 * @typedef {{snapshot(): Snapshot}} Controller
 * @typedef {typeof globalThis & {DeepSeekWebAdapter?: AdapterApi, __UXS_DEEPSEEK_B1__?: Controller}} Host
 */

const sessionPath = /^\/a\/chat\/s\/([^/]+)\/?$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const initializeErrors = new Set([
  "INSTANCE_EXISTS",
  "NOT_INITIALIZED",
  "DISPOSED",
  "PAGE_NOT_READY",
  "NOT_AUTHENTICATED",
  "SESSION_MISMATCH",
  "BUSY",
  "COMPOSER_NOT_EMPTY",
  "INTERNAL_ERROR",
]);

/** @param {string} pathname */
function sessionAt(pathname) {
  const id = sessionPath.exec(pathname)?.[1];
  return id && uuidPattern.test(id) ? id.toLowerCase() : null;
}

/** @param {unknown} error */
function errorCodeOf(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code;
  return typeof code === "string" && initializeErrors.has(code)
    ? code
    : "UNEXPECTED_ERROR";
}

/** Install one document-owned controller; Rust only reads its snapshot. */
export function main() {
  if (
    window.top !== window ||
    window.location.origin !== "https://chat.deepseek.com"
  )
    return;
  const host = /** @type {Host} */ (globalThis);
  if (host.__UXS_DEEPSEEK_B1__) return;

  const api = host.DeepSeekWebAdapter;
  const apiAvailable = Boolean(
    api &&
    typeof api.createDeepSeekAdapter === "function" &&
    typeof api.getDeepSeekAdapterInstance === "function",
  );
  /** @type {Adapter|null} */
  let owned = null;
  let boundPath = "";
  let boundGeneration = -1;
  let pathname = window.location.pathname;
  let generation = 0;
  let destroyed = false;
  let running = false;
  let requested = false;
  /** @type {Phase} */
  let phase = "waiting_path";
  /** @type {Initialization} */
  let initialization = "not_started";
  let attempts = 0;
  /** @type {string|null} */
  let sessionId = null;
  /** @type {string|null} */
  let errorCode = null;
  let pageNotReadyTimedOut = false;

  /** @returns {Snapshot} */
  function snapshot() {
    const currentPath = window.location.pathname;
    const currentId = sessionAt(currentPath);
    // getSession() 缓存并不跟随 SPA；只读快照按当前路径失效，不驱动生命周期。
    const valid =
      !destroyed &&
      phase === "ready" &&
      boundGeneration === generation &&
      currentPath === boundPath &&
      sessionId === currentId;
    return {
      schemaVersion: 1,
      generation,
      apiAvailable,
      adapterVersion: apiAvailable ? api.VERSION : null,
      phase: !destroyed && currentPath !== pathname ? "invalidated" : phase,
      initialization,
      attempts,
      pathBindable: currentId !== null,
      sessionPresent: sessionId !== null,
      sessionState: !currentId
        ? "unbound"
        : sessionId
          ? valid
            ? "valid"
            : "invalid"
          : "none",
      errorCode,
      pageNotReadyTimedOut,
    };
  }

  /**
   * Log only stable diagnostic codes, never upstream messages or UUID paths.
   * @param {string} stage
   * @param {string} code
   */
  function fail(stage, code) {
    errorCode = code;
    phase = destroyed ? "destroyed" : "failed";
    console.warn(`[uXS DeepSeek B1] ${stage} ${code}`);
  }

  function request() {
    requested = true;
    if (!running) void reconcile();
  }

  function observePath() {
    if (destroyed || pathname === window.location.pathname) return;
    pathname = window.location.pathname;
    generation++;
    phase = "invalidated";
    request();
  }

  /** @param {number} epoch @param {string} path */
  function isCurrent(epoch, path) {
    observePath();
    return !destroyed && epoch === generation && path === pathname;
  }

  /** @param {Adapter} instance @param {number} epoch @param {string} path */
  async function initialize(instance, epoch, path) {
    const finished = await wait.until(
      async () => {
        if (!isCurrent(epoch, path)) return true;
        attempts++;
        phase = "initializing";
        initialization = "pending";
        try {
          await instance.initialize();
        } catch (error) {
          // 旧 await 必须同时核对代次与路径；迟到失败不能污染新绑定。
          if (!isCurrent(epoch, path)) return true;
          initialization = "rejected";
          errorCode = errorCodeOf(error);
          if (errorCode === "PAGE_NOT_READY") {
            phase = "waiting_page";
            return false;
          }
          fail("initialize", errorCode);
          return true;
        }
        if (!isCurrent(epoch, path)) return true;
        initialization = "fulfilled";
        try {
          const session = instance.getSession();
          sessionId = session?.id.toLowerCase() ?? null;
          if (!sessionId) fail("getSession", "SESSION_MISSING");
          else if (sessionId !== sessionAt(path))
            fail("getSession", "SESSION_MISMATCH");
          else {
            phase = "ready";
            errorCode = null;
          }
        } catch (error) {
          fail("getSession", errorCodeOf(error));
        }
        // initialize() resolve 为 undefined，wait.until 必须显式返回真值。
        return true;
      },
      10_000,
      250,
    );
    if (!finished && isCurrent(epoch, path)) {
      pageNotReadyTimedOut = true;
      fail("wait", "PAGE_NOT_READY");
    }
  }

  async function reconcile() {
    running = true;
    try {
      while (requested) {
        requested = false;
        const epoch = generation;
        const path = pathname;
        // 失效归属于绑定代次；A→B→A 也不能复用 Adapter 已成功初始化的缓存。
        // 串行任务先等旧 initialize 收尾，再等 owned dispose 完成才能 create。
        if (owned && (destroyed || boundGeneration !== epoch)) {
          phase = destroyed ? "destroyed" : "disposing";
          await owned.dispose();
          owned = null;
          sessionId = null;
          if (!isCurrent(epoch, path)) continue;
        }
        if (destroyed) return;
        initialization = "not_started";
        attempts = 0;
        errorCode = null;
        pageNotReadyTimedOut = false;
        if (!apiAvailable) {
          fail("api", "API_MISSING");
          continue;
        }
        if (!sessionAt(path)) {
          phase = "waiting_path";
          continue;
        }
        if (!owned) {
          // 外部已有注册对象不属于 bootstrap；不 initialize，也不 dispose。
          if (api.getDeepSeekAdapterInstance()) {
            fail("create", "INSTANCE_EXISTS");
            continue;
          }
          owned = api.createDeepSeekAdapter();
          boundPath = path;
          boundGeneration = epoch;
        }
        await initialize(owned, epoch, path);
      }
    } catch (error) {
      requested = false;
      fail("lifecycle", errorCodeOf(error));
    } finally {
      running = false;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    generation++;
    phase = "destroyed";
    window.clearInterval(routePoll);
    window.removeEventListener("pagehide", destroy);
    window.removeEventListener("popstate", observePath);
    if (history.pushState === pushState) history.pushState = originalPushState;
    if (history.replaceState === replaceState)
      history.replaceState = originalReplaceState;
    request();
  }

  // 捕获两次轮询之间的快速 SPA 切换；保留网站原调用语义和后装函数的所有权。
  const history = window.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  /** @type {History["pushState"]} */
  const pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    observePath();
    return result;
  };
  /** @type {History["replaceState"]} */
  const replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    observePath();
    return result;
  };
  history.pushState = pushState;
  history.replaceState = replaceState;
  host.__UXS_DEEPSEEK_B1__ = { snapshot };
  const routePoll = window.setInterval(observePath, 250);
  window.addEventListener("pagehide", destroy, { once: true });
  window.addEventListener("popstate", observePath);
  request();
}
