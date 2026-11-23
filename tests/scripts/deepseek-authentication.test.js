import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthenticationCheck,
  queryAuthentication,
} from "@injected/deepseek-web/authentication.js";

/** @type {ReturnType<typeof vi.fn>} */
let fetch;
const authenticated = {
  code: 0,
  data: { biz_code: 0, biz_data: { id: "user", token: "private-token" } },
};

function check() {
  return queryAuthentication(new AbortController().signal);
}

/** @param {unknown} body */
function response(body) {
  return { ok: true, json: async () => body };
}

describe("DeepSeek explicit server authentication evidence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetch = vi.fn(async () => response(authenticated));
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    JSON.stringify({ value: "private-token", __version: "0" }),
    JSON.stringify("private-token"),
  ])(
    "reads official storage format and exports only normalized state",
    async (raw) => {
      window.localStorage.setItem("userToken", raw);
      expect(await check()).toEqual({
        status: "authenticated",
        diagnostic: null,
      });
      expect(fetch).toHaveBeenCalledWith("/api/v0/users/current", {
        method: "GET",
        headers: { Authorization: "Bearer private-token" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      });
    },
  );

  it.each([40002, 40003])(
    "only explicit server code %s confirms logout",
    async (code) => {
      fetch.mockResolvedValue(response({ code, data: null }));
      expect(await check()).toEqual({
        status: "unauthenticated",
        diagnostic: null,
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { code: 40012 },
    { code: 0, data: { biz_code: 1 } },
    { code: 0, data: { biz_code: 0, biz_data: { id: "user" } } },
    {},
  ])("unrecognized or incomplete response remains unknown", async (body) => {
    fetch.mockResolvedValue(response(body));
    expect((await check()).status).toBe("unknown");
  });

  it("missing token alone is not proof of logout", async () => {
    fetch.mockRejectedValue(new Error("network failure"));
    expect((await check()).status).toBe("unknown");
    expect(fetch.mock.calls[0][1].headers).toEqual({});
  });

  it("keeps unavailable credential storage unknown without breaking bootstrap or repeatedly logging", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const slot = createAuthenticationCheck();
    slot.observeCredentials();
    slot.observeCredentials();
    expect(slot.revision()).toBe(0);
    expect(warning).toHaveBeenCalledOnce();
    const id = slot.start();
    await vi.waitFor(() => expect(slot.read(id).status).toBe("unknown"));
    expect(fetch).not.toHaveBeenCalled();
    slot.close();
  });

  it.each(["{bad json", JSON.stringify({ value: "secret", __version: "1" })])(
    "does not query with malformed storage",
    async (raw) => {
      window.localStorage.setItem("userToken", raw);
      expect((await check()).status).toBe("unknown");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("ignores an old credential response after login or logout", async () => {
    fetch.mockImplementation(async () => {
      window.localStorage.setItem("userToken", JSON.stringify("new-token"));
      return response({ code: 40002 });
    });
    expect(await check()).toEqual({
      status: "checking",
      diagnostic: "CREDENTIAL_CHANGED",
    });
  });

  it("shares only pending work, then starts a fresh identity query", async () => {
    const slot = createAuthenticationCheck();
    const first = slot.start();
    expect(slot.start()).toBe(first);
    expect(slot.read(first).status).toBe("checking");
    await vi.waitFor(() =>
      expect(slot.read(first).status).toBe("authenticated"),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(slot.start()).toBe(first + 1);
    slot.close();
    expect(slot.read(first + 1).status).toBe("unknown");
  });

  it("invalidates pending credentials and prevents an old completion from replacing the new query", async () => {
    /** @type {((value: ReturnType<typeof response>) => void)[]} */
    const finish = [];
    fetch.mockImplementation(
      () => new Promise((resolve) => finish.push(resolve)),
    );
    window.localStorage.setItem("userToken", JSON.stringify("first-token"));
    const slot = createAuthenticationCheck();
    slot.observeCredentials();
    const old = slot.start();
    window.localStorage.removeItem("userToken");
    slot.observeCredentials();
    expect(slot.revision()).toBe(1);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    // Restore the old raw value too: equality at response time alone cannot
    // distinguish an A -> logout -> A identity change.
    window.localStorage.setItem("userToken", JSON.stringify("first-token"));
    slot.observeCredentials();
    const current = slot.start();
    finish[0](response(authenticated));
    // Drain fetch, response.json, query completion, and the slot callback.
    for (let index = 0; index < 8; index++) await Promise.resolve();
    expect(slot.read(old).status).not.toBe("authenticated");
    expect(slot.read(current).status).toBe("checking");
    finish[1](response({ code: 40002 }));
    await vi.waitFor(() =>
      expect(slot.read(current).status).not.toBe("checking"),
    );
    slot.close();
  });

  it("aborts its bounded request and does not publish after document close", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const slot = createAuthenticationCheck();
    const id = slot.start();
    await vi.advanceTimersByTimeAsync(8000);
    expect(slot.read(id)).toEqual({
      status: "unknown",
      diagnostic: "AUTH_TIMEOUT_OR_CANCELLED",
    });
    const next = slot.start();
    slot.close();
    await Promise.resolve();
    expect(slot.read(next)).toEqual({
      status: "unknown",
      diagnostic: "AUTH_CHECK_SUPERSEDED",
    });
  });
});
