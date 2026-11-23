import { wait } from "@injected/utils/async.js";
import { createAuthenticationCheck } from "./authentication.js";

/**
 * @typedef {"not_sent"|"unknown"|"confirmed"} Delivery
 * @typedef {{thinking?: boolean, webSearch?: boolean, timeoutMs?: number}} Options
 * @typedef {{code: string, message: string, stage: string, delivery: Delivery, remote: string, retryable: boolean, diagnostics: Record<string, string|number|boolean|null>}} RequestError
 * @typedef {{requestId: string, sessionId: string, status: "completed", content: string, durationMs: number}|{requestId: string, sessionId: string, status: "failed"|"uncertain", error: RequestError, durationMs: number}} GenerateResult
 * @typedef {{requestId: string, localWaitCancelled: boolean, delivery: Delivery, remoteStop: "not_attempted"|"attempted"|"observed"|"not_observed"}} CancelResult
 * @typedef {{initialize(): Promise<void>, getSession(): {id: string}|null, dispose(): Promise<void>, generate(request: {requestId: string, sessionId: string, parts: {type: "text", text: string}[], options?: Options}): Promise<GenerateResult>, cancel(requestId: string): Promise<CancelResult>}} Adapter
 * @typedef {{VERSION: string, createDeepSeekAdapter(): Adapter, getDeepSeekAdapterInstance(): Adapter|null}} AdapterApi
 * @typedef {"waiting_path"|"initializing"|"waiting_page"|"ready"|"invalidated"|"disposing"|"failed"|"destroyed"} Phase
 * @typedef {"not_started"|"pending"|"fulfilled"|"rejected"} Initialization
 * @typedef {{schemaVersion: number, generation: number, apiAvailable: boolean, adapterVersion: string|null, phase: Phase, initialization: Initialization, attempts: number, pathBindable: boolean, sessionPresent: boolean, sessionState: "none"|"valid"|"invalid"|"unbound", errorCode: string|null, pageNotReadyTimedOut: boolean}} Snapshot
 * @typedef {{documentToken: string, bindingGeneration: number, requestId: string}} Identity
 * @typedef {Identity & {text: string, options?: Options}} Envelope
 * @typedef {{requestId: string, status: "completed", content: string, durationMs: number}|{requestId: string, status: "failed"|"uncertain"|"rejected", error: RequestError, durationMs: number}} Result
 * @typedef {Identity & {kind: "accepted"}|{kind: "rejected", code: string}} StartAck
 * @typedef {Identity & ({kind: "pending"}|{kind: "terminal", result: Result}|{kind: "interrupted", code: string})|{kind: "rejected", code: string}} Readout
 * @typedef {{identity: Identity, adapter: Adapter, sessionId: string, startedAt: number, readout: Readout, cancelling: boolean}} Slot
 * @typedef {{snapshot(): Snapshot, bindDocument(token: string): boolean, start(envelope: Envelope): StartAck, read(identity: Identity): Readout, cancel(identity: Identity): boolean, ack(identity: Identity): boolean, startAuthenticationCheck(): number, readAuthenticationCheck(id: number): import("./authentication.js").Authentication}} Controller
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

/** @param {unknown} error @returns {RequestError} */
function rejectedError(error) {
  const value = /** @type {Partial<RequestError> & {remoteState?: string}} */ (
    error
  );
  const notSent =
    value?.code === "INVALID_REQUEST" || value?.code === "UNSUPPORTED_INPUT";
  return {
    code: typeof value?.code === "string" ? value.code : "UNEXPECTED_ERROR",
    // Error.message 非 enumerable，不能靠 stringify(Error) 交付拒绝语义。
    message:
      typeof value?.message === "string"
        ? value.message
        : "Generate promise rejected",
    stage: typeof value?.stage === "string" ? value.stage : "unknown",
    delivery: value?.delivery ?? (notSent ? "not_sent" : "unknown"),
    remote:
      typeof value?.remoteState === "string"
        ? value.remoteState
        : notSent
          ? "not_started"
          : "unknown",
    retryable: value?.retryable === true,
    diagnostics: scalarDiagnostics(value?.diagnostics),
  };
}

/** @param {unknown} diagnostics @returns {RequestError["diagnostics"]} */
function scalarDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return {};
  return Object.fromEntries(
    Object.entries(diagnostics).filter(
      ([, value]) =>
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)),
    ),
  );
}

/** Install one document-owned controller; snapshot remains purely read-only. */
export function main() {
  if (
    window.top !== window ||
    window.location.origin !== "https://chat.deepseek.com"
  )
    return;
  const host = /** @type {Host} */ (globalThis);
  if (host.__UXS_DEEPSEEK_B1__) return;

  const api = host.DeepSeekWebAdapter;
  const authentication = createAuthenticationCheck();
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
  let documentToken = "";
  /** @type {Slot|null} */
  let slot = null;
  // 本地等待结束不等于远端停止；失联/uncertain 后只能由操作者核对并重启应用。
  let quarantined = false;

  /** @param {string} token */
  function bindDocument(token) {
    if (!token || destroyed || (documentToken && documentToken !== token))
      return false;
    documentToken = token;
    return true;
  }

  /** @param {Identity} identity */
  function matches(identity) {
    return (
      slot !== null &&
      identity.documentToken === slot.identity.documentToken &&
      identity.bindingGeneration === slot.identity.bindingGeneration &&
      identity.requestId === slot.identity.requestId
    );
  }

  /** @param {Slot} active @param {string} code */
  function interrupt(active, code) {
    if (active.readout.kind === "interrupted") return;
    quarantined = true;
    active.readout = { kind: "interrupted", ...active.identity, code };
  }

  /** @param {Slot} active @param {Result} result */
  function complete(active, result) {
    observePath();
    if (slot !== active || active.readout.kind !== "pending") return;
    if (destroyed || active.identity.bindingGeneration !== generation) {
      interrupt(active, destroyed ? "DOCUMENT_DESTROYED" : "BINDING_CHANGED");
      return;
    }
    if (
      result.status === "uncertain" ||
      (result.status !== "completed" &&
        result.error.delivery !== "not_sent" &&
        result.error.remote !== "stopped")
    )
      quarantined = true;
    active.readout = { kind: "terminal", ...active.identity, result };
  }

  /** @param {Slot} active @param {unknown} error */
  function rejectGenerate(active, error) {
    complete(active, {
      requestId: active.identity.requestId,
      status: "rejected",
      durationMs: Math.max(0, Date.now() - active.startedAt),
      error: rejectedError(error),
    });
  }

  /** @param {Envelope} envelope @returns {StartAck} */
  function start(envelope) {
    observePath();
    // ack 丢失后重发同一 identity 仍只确认原槽，绝不再次 generate。
    if (matches(envelope)) return { kind: "accepted", ...slot.identity };
    if (quarantined) return { kind: "rejected", code: "QUARANTINED" };
    if (slot) return { kind: "rejected", code: "BUSY" };
    if (!documentToken || envelope.documentToken !== documentToken)
      return { kind: "rejected", code: "DOCUMENT_MISMATCH" };
    if (
      destroyed ||
      !owned ||
      phase !== "ready" ||
      boundGeneration !== generation ||
      envelope.bindingGeneration !== generation ||
      pathname !== boundPath ||
      window.location.pathname !== boundPath
    )
      return { kind: "rejected", code: "BINDING_NOT_READY" };
    const identity = {
      documentToken,
      bindingGeneration: generation,
      requestId: envelope.requestId,
    };
    // 同一同步段取得 owned 缓存 Session 并立即 generate，不能改用 URL ID 或夹入 await。
    let boundSession;
    try {
      boundSession = owned.getSession();
    } catch {
      return { kind: "rejected", code: "SESSION_READ_FAILED" };
    }
    if (
      !boundSession ||
      boundSession.id.toLowerCase() !== sessionId ||
      sessionId !== sessionAt(boundPath)
    )
      return { kind: "rejected", code: "SESSION_MISMATCH" };
    const active = {
      identity,
      adapter: owned,
      sessionId: boundSession.id.toLowerCase(),
      startedAt: Date.now(),
      readout: /** @type {Readout} */ ({ kind: "pending", ...identity }),
      cancelling: false,
    };
    slot = active;
    try {
      const pending = owned.generate({
        requestId: identity.requestId,
        sessionId: boundSession.id,
        parts: [{ type: "text", text: envelope.text }],
        ...(envelope.options === undefined
          ? {}
          : { options: envelope.options }),
      });
      void pending
        .then(
          (result) => {
            if (
              result.requestId !== identity.requestId ||
              result.sessionId !== active.sessionId ||
              !["completed", "failed", "uncertain"].includes(result.status)
            ) {
              rejectGenerate(active, {
                code: "PROTOCOL_ERROR",
                message: "Adapter result identity or status mismatch",
                delivery: "unknown",
              });
              return;
            }
            const common = {
              requestId: result.requestId,
              durationMs: result.durationMs,
            };
            complete(
              active,
              result.status === "completed"
                ? { ...common, status: "completed", content: result.content }
                : {
                    ...common,
                    status: result.status,
                    error: {
                      ...result.error,
                      diagnostics: scalarDiagnostics(result.error.diagnostics),
                    },
                  },
            );
          },
          (error) => rejectGenerate(active, error),
        )
        .catch((error) => rejectGenerate(active, error));
    } catch (error) {
      rejectGenerate(active, error);
    }
    return { kind: "accepted", ...identity };
  }

  /** @param {Identity} identity @returns {Readout} */
  function read(identity) {
    observePath();
    if (!slot) return { kind: "rejected", code: "SLOT_MISSING" };
    return matches(identity)
      ? slot.readout
      : { kind: "rejected", code: "IDENTITY_MISMATCH" };
  }

  /** @param {Identity} identity */
  function cancel(identity) {
    observePath();
    if (!matches(identity)) return false;
    const active = slot;
    interrupt(active, "HOST_CANCELLED");
    if (!active.cancelling) {
      active.cancelling = true;
      // cancel 的 Promise 不能阻塞宿主超时结束，也不能当作 remote stopped 的证明。
      void active.adapter.cancel(identity.requestId).catch(() => {
        console.warn("[uXS DeepSeek B2] cancel CANCEL_REJECTED");
      });
    }
    return true;
  }

  /** @param {Identity} identity */
  function ack(identity) {
    observePath();
    if (!matches(identity) || slot.readout.kind === "pending") return false;
    // Rust 读到 terminal 后仍可能发生 SPA；ack 的布尔值同时是最后的绑定代次门。
    const current =
      slot.readout.kind === "terminal" &&
      !destroyed &&
      identity.bindingGeneration === generation;
    slot = null;
    return current;
  }

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
    if (slot) interrupt(slot, "BINDING_CHANGED");
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
    authentication.close();
    generation++;
    if (slot) interrupt(slot, "DOCUMENT_DESTROYED");
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
  host.__UXS_DEEPSEEK_B1__ = {
    startAuthenticationCheck: authentication.start,
    readAuthenticationCheck: authentication.read,
    snapshot,
    bindDocument,
    start,
    read,
    cancel,
    ack,
  };
  const routePoll = window.setInterval(observePath, 250);
  window.addEventListener("pagehide", destroy, { once: true });
  window.addEventListener("popstate", observePath);
  request();
}
