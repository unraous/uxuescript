import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "@injected/deepseek-web/bootstrap.js";
import adapterScript from "../../dist/scripts/embedded/deepseek-web-adapter.js?raw";

/** @typedef {import("@injected/deepseek-web/bootstrap.js").Adapter} Adapter */
/** @typedef {import("@injected/deepseek-web/bootstrap.js").Host} Host */
const host = /** @type {Host} */ (globalThis);
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const firstPath = `/a/chat/s/${firstId}`;
const secondPath = `/a/chat/s/${secondId}`;

/** @returns {{promise: Promise<void>, resolve: () => void, reject: (reason: unknown) => void}} */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** @param {string} code */
function adapterError(code) {
  return Object.assign(new Error("upstream diagnostics must not be logged"), {
    code,
  });
}

async function settle() {
  // initialize / wait.until / serialized cleanup each has its own microtask.
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

/** @type {Omit<Window, "location"> & {location: URL}} */
let page;
/** @type {Adapter|null} */
let registered;
/** @type {ReturnType<typeof vi.spyOn>} */
let warning;

/**
 * Simulates only the public adapter registry and async lifecycle contract.
 * @param {() => Promise<void>} [initialize]
 * @param {() => Promise<void>} [dispose]
 * @param {string} [id]
 */
function adapter(
  initialize = () => Promise.resolve(),
  dispose = () => Promise.resolve(),
  id = firstId,
) {
  let initialized = false;
  const instance = {
    initialize: vi.fn(async () => {
      await initialize();
      initialized = true;
    }),
    getSession: vi.fn(() => (initialized ? { id } : null)),
    dispose: vi.fn(async () => {
      await dispose();
      initialized = false;
      if (registered === instance) registered = null;
    }),
    generate: vi.fn(),
    cancel: vi.fn(async (requestId) => ({
      requestId,
      localWaitCancelled: true,
      delivery: /** @type {const} */ ("unknown"),
      remoteStop: /** @type {const} */ ("not_observed"),
    })),
  };
  return instance;
}

/** @param {Adapter[]} instances */
function installApi(instances) {
  host.DeepSeekWebAdapter = {
    VERSION: "0.1.0",
    getDeepSeekAdapterInstance: vi.fn(() => registered),
    createDeepSeekAdapter: vi.fn(() => {
      if (registered) throw adapterError("INSTANCE_EXISTS");
      const next = instances.shift();
      if (!next) throw new Error("Test did not provide a new adapter");
      registered = next;
      return next;
    }),
  };
  return host.DeepSeekWebAdapter;
}

function snapshot() {
  expect(
    host.__UXS_DEEPSEEK_B1__,
    "bootstrap should install its controller",
  ).toBeDefined();
  return host.__UXS_DEEPSEEK_B1__.snapshot();
}

/** @param {string} pathname */
function navigate(pathname) {
  page.location.pathname = pathname;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
    ],
  });
  const events = new EventTarget();
  const localStorage = window.localStorage;
  localStorage.clear();
  page = /** @type {typeof page} */ (
    /** @type {unknown} */ ({
      location: new URL(`https://chat.deepseek.com${firstPath}`),
      localStorage,
      get top() {
        return page;
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      history: {
        pushState: vi.fn(
          (
            /** @type {unknown} */ _data,
            /** @type {string} */ _unused,
            /** @type {string|URL|null} */ url,
          ) => {
            if (url != null) page.location = new URL(url, page.location);
          },
        ),
        replaceState: vi.fn(
          (
            /** @type {unknown} */ _data,
            /** @type {string} */ _unused,
            /** @type {string|URL|null} */ url,
          ) => {
            if (url != null) page.location = new URL(url, page.location);
          },
        ),
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    })
  );
  vi.stubGlobal("window", page);
  registered = null;
  warning = vi.spyOn(console, "warn").mockImplementation(() => {});
});

it("samples credential changes with the existing route timer without issuing auth queries or rebinding", async () => {
  const owned = adapter();
  const api = installApi([owned]);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  main();
  await settle();
  expect(snapshot().authenticationRevision).toBe(0);
  page.localStorage.setItem("userToken", JSON.stringify("private-token"));
  // Snapshot remains read-only; only the document's existing timer samples.
  expect(snapshot().authenticationRevision).toBe(0);
  await vi.advanceTimersByTimeAsync(250);
  expect(snapshot().authenticationRevision).toBe(1);
  page.localStorage.removeItem("userToken");
  await vi.advanceTimersByTimeAsync(250);
  expect(snapshot().authenticationRevision).toBe(2);
  await vi.advanceTimersByTimeAsync(500);
  expect(snapshot().authenticationRevision).toBe(2);
  expect(snapshot().generation).toBe(0);
  expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(snapshot())).not.toContain("private-token");
});

afterEach(async () => {
  page.dispatchEvent(new Event("pagehide"));
  await settle();
  delete host.__UXS_DEEPSEEK_B1__;
  delete host.DeepSeekWebAdapter;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DeepSeek B2 single request bridge", () => {
  const identity = {
    documentToken: "process:document-1",
    bindingGeneration: 0,
    requestId: "process:request-1",
  };
  const envelope = {
    ...identity,
    text: 'quoted " text\n完整回答',
    options: { timeoutMs: 1_000 },
  };
  const completed = {
    requestId: identity.requestId,
    sessionId: firstId,
    status: /** @type {const} */ ("completed"),
    content: "完整回答\n不是 response 对象",
    durationMs: 25,
  };

  async function ready() {
    const owned = adapter();
    installApi([owned, adapter(undefined, undefined, secondId)]);
    main();
    await settle();
    const controller = host.__UXS_DEEPSEEK_B1__;
    expect(controller.bindDocument(identity.documentToken)).toBe(true);
    return { owned, controller };
  }

  it("retains the complete correlated result until ack and deduplicates start without sending twice", async () => {
    const { owned, controller } = await ready();
    const pending = deferred();
    owned.generate.mockImplementation(async () => {
      await pending.promise;
      return completed;
    });
    const accepted = controller.start(envelope);
    expect(accepted).toEqual({ kind: "accepted", ...identity });
    expect(
      controller.start({ ...envelope, text: "must not replace the original" }),
    ).toEqual(accepted);
    expect(owned.generate).toHaveBeenCalledOnce();
    expect(owned.generate).toHaveBeenCalledWith({
      requestId: identity.requestId,
      sessionId: firstId,
      parts: [{ type: "text", text: envelope.text }],
      options: envelope.options,
    });
    expect(
      controller.start({ ...envelope, requestId: "second" }),
    ).toMatchObject({ kind: "rejected", code: "BUSY" });
    pending.resolve();
    await settle();
    expect(controller.read(identity)).toEqual({
      kind: "terminal",
      ...identity,
      result: {
        requestId: identity.requestId,
        status: "completed",
        content: completed.content,
        durationMs: 25,
      },
    });
    expect(controller.read(identity)).toEqual(controller.read(identity));
    expect(controller.ack({ ...identity, requestId: "foreign" })).toBe(false);
    expect(controller.ack(identity)).toBe(true);
    expect(controller.read(identity)).toMatchObject({
      kind: "rejected",
      code: "SLOT_MISSING",
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("preserves failed and uncertain error semantics, releasing only safe not-sent failure", async () => {
    const { owned, controller } = await ready();
    const error = {
      code: "COMPOSER_NOT_EMPTY",
      message: "input was preserved",
      stage: "checking_page",
      delivery: /** @type {const} */ ("not_sent"),
      remote: "not_started",
      retryable: false,
      diagnostics: { candidateCount: 2 },
    };
    owned.generate.mockResolvedValue({ ...completed, status: "failed", error });
    controller.start(envelope);
    await settle();
    expect(controller.read(identity)).toMatchObject({
      kind: "terminal",
      result: { status: "failed", error },
    });
    expect(controller.read(identity)).not.toHaveProperty("result.content");
    expect(controller.ack(identity)).toBe(true);
    const next = { ...envelope, requestId: "process:request-2" };
    owned.generate.mockResolvedValue({
      ...completed,
      requestId: next.requestId,
      status: "uncertain",
      error: {
        ...error,
        code: "RESPONSE_TIMEOUT",
        delivery: "confirmed",
        remote: "generating",
      },
    });
    expect(controller.start(next).kind).toBe("accepted");
    await settle();
    expect(controller.read(next)).toMatchObject({
      kind: "terminal",
      result: {
        status: "uncertain",
        error: {
          delivery: "confirmed",
          remote: "generating",
          code: "RESPONSE_TIMEOUT",
        },
      },
    });
    controller.ack(next);
    expect(
      controller.start({ ...envelope, requestId: "process:request-3" }),
    ).toMatchObject({ kind: "rejected", code: "QUARANTINED" });
    expect(owned.generate).toHaveBeenCalledTimes(2);
  });

  it("serializes rejected Error messages explicitly and quarantines a wrong SDK identity", async () => {
    const { owned, controller } = await ready();
    owned.generate.mockRejectedValue(
      Object.assign(
        new Error("not enumerable, delivered only to local caller"),
        { code: "INVALID_REQUEST", stage: "validating", retryable: false },
      ),
    );
    controller.start(envelope);
    await settle();
    expect(controller.read(identity)).toMatchObject({
      kind: "terminal",
      result: {
        status: "rejected",
        error: {
          code: "INVALID_REQUEST",
          message: "not enumerable, delivered only to local caller",
          delivery: "not_sent",
          remote: "not_started",
        },
      },
    });
    controller.ack(identity);
    const next = { ...envelope, requestId: "process:request-2" };
    owned.generate.mockResolvedValue({
      ...completed,
      requestId: next.requestId,
      sessionId: secondId,
    });
    controller.start(next);
    await settle();
    expect(controller.read(next)).toMatchObject({
      kind: "terminal",
      result: {
        status: "rejected",
        error: { code: "PROTOCOL_ERROR", delivery: "unknown" },
      },
    });
    controller.ack(next);
    expect(
      controller.start({ ...envelope, requestId: "process:request-3" }),
    ).toMatchObject({ kind: "rejected", code: "QUARANTINED" });
    expect(warning.mock.calls.flat().join(" ")).not.toContain("not enumerable");
    expect(warning.mock.calls.flat().join(" ")).not.toContain(secondId);
  });

  it("ends an inflight SPA binding synchronously and never publishes its late completed result", async () => {
    const { owned, controller } = await ready();
    const pending = deferred();
    owned.generate.mockImplementation(async () => {
      await pending.promise;
      return completed;
    });
    controller.start(envelope);
    page.history.pushState(null, "", secondPath);
    expect(controller.read(identity)).toMatchObject({
      kind: "interrupted",
      code: "BINDING_CHANGED",
    });
    pending.resolve();
    await settle();
    expect(controller.read(identity)).toMatchObject({
      kind: "interrupted",
      code: "BINDING_CHANGED",
    });
    expect(controller.read(identity)).not.toHaveProperty("result");
    controller.ack(identity);
    expect(
      controller.start({
        ...envelope,
        bindingGeneration: snapshot().generation,
        requestId: "process:request-2",
      }),
    ).toMatchObject({ kind: "rejected", code: "QUARANTINED" });
    expect(owned.generate).toHaveBeenCalledOnce();
  });
});

describe("DeepSeek B1 bootstrap public adapter integration", () => {
  it("the embedded IIFE exposes its public API in document global scope", () => {
    /** @type {{DeepSeekWebAdapter?: Host["DeepSeekWebAdapter"]}} */
    const documentGlobal = {};
    runInNewContext(adapterScript, documentGlobal);
    expect(documentGlobal.DeepSeekWebAdapter.VERSION).toBe("0.1.0");
    expect(typeof documentGlobal.DeepSeekWebAdapter.createDeepSeekAdapter).toBe(
      "function",
    );
    expect(
      documentGlobal.DeepSeekWebAdapter.getDeepSeekAdapterInstance(),
    ).toBeNull();
  });

  it("awaits initialization before reporting a valid session and exposes only synchronous JSON data", async () => {
    const pending = deferred();
    const owned = adapter(() => pending.promise);
    const api = installApi([owned]);
    main();
    expect(snapshot()).toMatchObject({
      schemaVersion: 1,
      apiAvailable: true,
      adapterVersion: "0.1.0",
      phase: "initializing",
      initialization: "pending",
      attempts: 1,
      pathBindable: true,
      sessionPresent: false,
      sessionState: "none",
    });
    expect(owned.getSession).not.toHaveBeenCalled();
    pending.resolve();
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "ready",
      initialization: "fulfilled",
      sessionPresent: true,
      sessionState: "valid",
      errorCode: null,
    });
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    expect(JSON.stringify(snapshot())).not.toContain(firstId);
    expect(JSON.parse(JSON.stringify(snapshot()))).toEqual(snapshot());
    expect(owned.generate).not.toHaveBeenCalled();
  });

  it("reports a rejected initialize without treating a scheduled Promise as completion", async () => {
    const pending = deferred();
    const owned = adapter(() => pending.promise);
    installApi([owned]);
    main();
    pending.reject(adapterError("COMPOSER_NOT_EMPTY"));
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "failed",
      initialization: "rejected",
      errorCode: "COMPOSER_NOT_EMPTY",
      sessionState: "none",
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(owned.initialize).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "[uXS DeepSeek B1] initialize COMPOSER_NOT_EMPTY",
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain("upstream");
  });

  it("retries PAGE_NOT_READY on the same registered failed instance, then becomes ready", async () => {
    let ready = false;
    const owned = adapter(async () => {
      if (!ready) throw adapterError("PAGE_NOT_READY");
    });
    const api = installApi([owned]);
    main();
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "waiting_page",
      initialization: "rejected",
      attempts: 1,
      errorCode: "PAGE_NOT_READY",
      pageNotReadyTimedOut: false,
    });
    ready = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(snapshot()).toMatchObject({
      phase: "ready",
      attempts: 2,
      initialization: "fulfilled",
      errorCode: null,
    });
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    expect(owned.dispose).not.toHaveBeenCalled();
  });

  it("bounds PAGE_NOT_READY polling to ten seconds and does not restart on duplicate entry", async () => {
    const owned = adapter(() => Promise.reject(adapterError("PAGE_NOT_READY")));
    installApi([owned]);
    main();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshot()).toMatchObject({
      phase: "failed",
      initialization: "rejected",
      attempts: 40,
      errorCode: "PAGE_NOT_READY",
      pageNotReadyTimedOut: true,
    });
    main();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(owned.initialize).toHaveBeenCalledTimes(40);
  });

  it("does not create or initialize concurrently on repeated entry while pending or after success", async () => {
    const pending = deferred();
    const owned = adapter(() => pending.promise);
    const api = installApi([owned]);
    main();
    const controller = host.__UXS_DEEPSEEK_B1__;
    main();
    main();
    expect(host.__UXS_DEEPSEEK_B1__).toBe(controller);
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    expect(owned.initialize).toHaveBeenCalledOnce();
    pending.resolve();
    await settle();
    main();
    await settle();
    expect(owned.initialize).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("immediately invalidates a changed pathname even before its local route poll", async () => {
    const owned = adapter();
    installApi([owned, adapter(undefined, undefined, secondId)]);
    main();
    await settle();
    expect(snapshot().sessionState).toBe("valid");
    navigate(secondPath);
    expect(snapshot()).toMatchObject({
      sessionState: "invalid",
      sessionPresent: true,
    });
    expect(owned.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(snapshot().sessionState).toBe("valid");
    expect(owned.dispose).toHaveBeenCalledOnce();
  });

  it("waits for stale pending initialization and owned disposal before creating for the latest route", async () => {
    const pending = deferred();
    const cleanup = deferred();
    const old = adapter(
      () => pending.promise,
      () => cleanup.promise,
    );
    const next = adapter(undefined, undefined, secondId);
    const api = installApi([old, next]);
    main();
    navigate(secondPath);
    snapshot();
    await settle();
    expect(old.dispose).not.toHaveBeenCalled();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    pending.resolve();
    await settle();
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(snapshot().sessionState).not.toBe("valid");
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    cleanup.resolve();
    await settle();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(2);
    expect(next.initialize).toHaveBeenCalledOnce();
    expect(snapshot()).toMatchObject({
      phase: "ready",
      initialization: "fulfilled",
      attempts: 1,
      sessionState: "valid",
    });
  });

  it("discards stale rejections and follows SPA changes without Rust or repeated bootstrap", async () => {
    const pending = deferred();
    const old = adapter(() => pending.promise);
    const next = adapter(undefined, undefined, secondId);
    const api = installApi([old, next]);
    main();
    navigate("/");
    await vi.advanceTimersByTimeAsync(250);
    navigate(secondPath);
    await vi.advanceTimersByTimeAsync(250);
    pending.reject(adapterError("BUSY"));
    await settle();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(2);
    expect(snapshot()).toMatchObject({ phase: "ready", errorCode: null });
    expect(warning).not.toHaveBeenCalled();
  });

  it("never initializes or disposes an adapter created by another owner", async () => {
    const foreign = adapter();
    const api = installApi([]);
    registered = foreign;
    main();
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "failed",
      initialization: "not_started",
      errorCode: "INSTANCE_EXISTS",
    });
    navigate(secondPath);
    await vi.advanceTimersByTimeAsync(250);
    page.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(api.createDeepSeekAdapter).not.toHaveBeenCalled();
    expect(foreign.initialize).not.toHaveBeenCalled();
    expect(foreign.dispose).not.toHaveBeenCalled();
  });

  it("treats a home path as unbound, not authenticated, and binds when a UUID session path appears", async () => {
    const owned = adapter();
    const api = installApi([owned]);
    navigate("/");
    main();
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "waiting_path",
      initialization: "not_started",
      pathBindable: false,
      sessionState: "unbound",
      errorCode: null,
    });
    expect(api.createDeepSeekAdapter).not.toHaveBeenCalled();
    navigate(firstPath);
    await vi.advanceTimersByTimeAsync(250);
    expect(snapshot().sessionState).toBe("valid");
    navigate("/");
    expect(snapshot().sessionState).toBe("unbound");
    await vi.advanceTimersByTimeAsync(250);
    expect(owned.dispose).toHaveBeenCalledOnce();
    expect(snapshot().phase).toBe("waiting_path");
  });

  it("stops observing on page destruction and isolates a late initialization result before owned cleanup", async () => {
    const pending = deferred();
    const owned = adapter(() => pending.promise);
    const api = installApi([owned]);
    main();
    page.dispatchEvent(new Event("pagehide"));
    expect(snapshot()).toMatchObject({ phase: "destroyed" });
    expect(vi.getTimerCount()).toBe(0);
    expect(owned.dispose).not.toHaveBeenCalled();
    pending.resolve();
    await settle();
    expect(owned.dispose).toHaveBeenCalledOnce();
    expect(snapshot()).toMatchObject({
      phase: "destroyed",
      sessionPresent: false,
      sessionState: "none",
    });
    navigate(secondPath);
    main();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
  });

  it("reports missing API and unexpected getSession failures without leaking upstream details", async () => {
    main();
    await settle();
    expect(snapshot()).toMatchObject({
      apiAvailable: false,
      phase: "failed",
      errorCode: "API_MISSING",
    });
    page.dispatchEvent(new Event("pagehide"));
    await settle();
    delete host.__UXS_DEEPSEEK_B1__;
    const owned = adapter(undefined, undefined, secondId);
    owned.getSession.mockImplementation(() => {
      throw new Error(`private session ${secondId}`);
    });
    installApi([owned]);
    main();
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "failed",
      initialization: "fulfilled",
      errorCode: "UNEXPECTED_ERROR",
    });
    expect(warning.mock.calls.flat().join(" ")).not.toContain(secondId);
  });

  it.each(["resolve", "reject"])(
    "freshly binds after pending A→B→A and a stale %s",
    async (outcome) => {
      const pending = deferred();
      const old = adapter(() => pending.promise);
      const fresh = adapter();
      const api = installApi([old, fresh]);
      main();
      page.history.pushState(null, "", secondPath);
      await vi.advanceTimersByTimeAsync(250);
      page.history.replaceState(null, "", firstPath);
      await vi.advanceTimersByTimeAsync(250);
      if (outcome === "resolve") pending.resolve();
      else pending.reject(adapterError("BUSY"));
      await settle();
      expect(old.dispose).toHaveBeenCalledOnce();
      expect(old.initialize).toHaveBeenCalledOnce();
      expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(2);
      expect(fresh.initialize).toHaveBeenCalledOnce();
      expect(snapshot()).toMatchObject({
        phase: "ready",
        sessionState: "valid",
        errorCode: null,
      });
      expect(warning).not.toHaveBeenCalled();
    },
  );

  it("does not recover a ready cached binding after a fast history A→B→A before the next poll", async () => {
    const cleanup = deferred();
    const old = adapter(undefined, () => cleanup.promise);
    const fresh = adapter();
    const api = installApi([old, fresh]);
    main();
    await settle();
    page.history.pushState(null, "", secondPath);
    expect(snapshot().sessionState).toBe("invalid");
    page.history.replaceState(null, "", firstPath);
    expect(snapshot().sessionState).toBe("invalid");
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    cleanup.resolve();
    await settle();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(2);
    expect(fresh.initialize).toHaveBeenCalledOnce();
    expect(snapshot().sessionState).toBe("valid");
  });

  it.each(["/A/chat/s", "/a/CHAT/s", "/a/chat/S"])(
    "keeps the fixed prefix case-sensitive for %s",
    async (prefix) => {
      const api = installApi([adapter()]);
      navigate(`${prefix}/${firstId}`);
      main();
      await settle();
      expect(snapshot()).toMatchObject({
        phase: "waiting_path",
        pathBindable: false,
        sessionState: "unbound",
      });
      expect(api.createDeepSeekAdapter).not.toHaveBeenCalled();
    },
  );

  it("allows uppercase UUID characters under the exact lowercase prefix", async () => {
    const upper = "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF";
    installApi([adapter(undefined, undefined, upper.toLowerCase())]);
    navigate(`/a/chat/s/${upper}/`);
    main();
    await settle();
    expect(snapshot()).toMatchObject({
      phase: "ready",
      pathBindable: true,
      sessionState: "valid",
    });
  });

  it("follows popstate immediately and preserves a later site history function during cleanup", async () => {
    const old = adapter();
    installApi([old, adapter(undefined, undefined, secondId)]);
    const originalPush = page.history.pushState;
    const originalReplace = page.history.replaceState;
    main();
    await settle();
    expect(page.history.pushState).not.toBe(originalPush);
    navigate(secondPath);
    page.dispatchEvent(new Event("popstate"));
    expect(old.dispose).toHaveBeenCalledOnce();
    await settle();
    const sitePush = vi.fn(originalPush);
    page.history.pushState = sitePush;
    page.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(page.history.pushState).toBe(sitePush);
    expect(page.history.replaceState).toBe(originalReplace);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("binds only the latest route when paths continue changing during owned disposal", async () => {
    const cleanup = deferred();
    const old = adapter(undefined, () => cleanup.promise);
    const fresh = adapter();
    const api = installApi([old, fresh]);
    main();
    await settle();
    page.history.pushState(null, "", secondPath);
    await vi.advanceTimersByTimeAsync(250);
    expect(old.dispose).toHaveBeenCalledOnce();
    page.history.replaceState(null, "", "/");
    page.history.pushState(null, "", firstPath);
    await vi.advanceTimersByTimeAsync(250);
    expect(api.createDeepSeekAdapter).toHaveBeenCalledOnce();
    cleanup.resolve();
    await settle();
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(2);
    expect(fresh.initialize).toHaveBeenCalledOnce();
    expect(snapshot().sessionState).toBe("valid");
  });

  it.each(["switch", "destroy"])(
    "stops PAGE_NOT_READY retries on %s",
    async (action) => {
      const old = adapter(() => Promise.reject(adapterError("PAGE_NOT_READY")));
      const api = installApi([old, adapter(undefined, undefined, secondId)]);
      main();
      await settle();
      expect(snapshot().phase).toBe("waiting_page");
      if (action === "switch") page.history.pushState(null, "", secondPath);
      else page.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(250);
      expect(old.initialize).toHaveBeenCalledOnce();
      expect(old.dispose).toHaveBeenCalledOnce();
      expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(
        action === "switch" ? 2 : 1,
      );
      expect(snapshot().phase).toBe(
        action === "switch" ? "ready" : "destroyed",
      );
      if (action === "destroy") expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("distinguishes successive fast successful bindings even when all other ready fields match", async () => {
    const old = adapter();
    const fresh = adapter(undefined, undefined, secondId);
    const api = installApi([old, fresh]);
    main();
    await settle();
    const firstReady = snapshot();
    page.history.pushState(null, "", secondPath);
    await settle();
    const nextReady = snapshot();
    expect(api.createDeepSeekAdapter).toHaveBeenCalledTimes(2);
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(firstReady.sessionState).toBe("valid");
    expect(nextReady.sessionState).toBe("valid");
    expect(nextReady).not.toEqual(firstReady);
    const { generation: firstGeneration, ...firstOther } = firstReady;
    const { generation: nextGeneration, ...nextOther } = nextReady;
    expect(firstGeneration).toBe(0);
    expect(nextGeneration).toBe(1);
    expect(nextOther).toEqual(firstOther);
  });

  it("only advances generation for invalidation, never for repeated synchronous snapshots", async () => {
    installApi([adapter(), adapter(undefined, undefined, secondId)]);
    main();
    await settle();
    expect(snapshot().generation).toBe(0);
    for (let index = 0; index < 4; index++)
      expect(snapshot().generation).toBe(0);
    page.history.replaceState(null, "", firstPath);
    expect(snapshot().generation).toBe(0);
    page.history.pushState(null, "", secondPath);
    await settle();
    for (let index = 0; index < 4; index++)
      expect(snapshot().generation).toBe(1);
  });

  it("does not run in subframes or outside the exact HTTPS origin", () => {
    const api = installApi([]);
    page.location.protocol = "http:";
    main();
    expect(host.__UXS_DEEPSEEK_B1__).toBeUndefined();
    page.location = new URL(`https://chat.deepseek.com:8443${firstPath}`);
    main();
    expect(host.__UXS_DEEPSEEK_B1__).toBeUndefined();
    page.location = new URL(`https://chat.deepseek.com${firstPath}`);
    Object.defineProperty(page, "top", { value: {} });
    main();
    expect(host.__UXS_DEEPSEEK_B1__).toBeUndefined();
    expect(api.createDeepSeekAdapter).not.toHaveBeenCalled();
  });
});
