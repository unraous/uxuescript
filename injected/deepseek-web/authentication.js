/** @typedef {{status: "checking"|"authenticated"|"unauthenticated"|"unknown", diagnostic: string|null}} Authentication */

/**
 * Official frontend main.07dbace284.js (2026-11-23): storage module 91805
 * wraps userToken as {value, __version:"0"}; users/current is the read-only
 * identity query. API result codes 40002/40003 mean missing/invalid token.
 * Session UUIDs and Adapter initialization are deliberately not auth evidence.
 * @param {AbortSignal} signal
 * @returns {Promise<Authentication>}
 */
export async function queryAuthentication(signal) {
  try {
    const raw = window.localStorage.getItem("userToken");
    const stored = raw === null ? null : JSON.parse(raw);
    const token =
      stored && typeof stored === "object" && stored.__version === "0"
        ? stored.value
        : stored;
    if (token !== null && typeof token !== "string")
      return { status: "unknown", diagnostic: "INVALID_TOKEN_STORAGE" };
    const response = await window.fetch("/api/v0/users/current", {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (!response.ok)
      return { status: "unknown", diagnostic: "AUTH_HTTP_ERROR" };
    const body = await response.json();
    // A login/logout can finish while this query is in flight. Its previous
    // credential's response cannot describe the newly selected identity.
    if (raw !== window.localStorage.getItem("userToken"))
      return { status: "checking", diagnostic: "CREDENTIAL_CHANGED" };
    if (signal.aborted)
      return { status: "unknown", diagnostic: "AUTH_TIMEOUT_OR_CANCELLED" };
    if (body?.code === 40002 || body?.code === 40003)
      return { status: "unauthenticated", diagnostic: null };
    const user = body?.data?.biz_data;
    if (
      body?.code === 0 &&
      body?.data?.biz_code === 0 &&
      typeof user?.id === "string" &&
      user.id.length > 0 &&
      typeof user?.token === "string" &&
      user.token.length > 0
    )
      return { status: "authenticated", diagnostic: null };
    return { status: "unknown", diagnostic: "UNRECOGNIZED_AUTH_RESPONSE" };
  } catch {
    // Never export a token, user profile, response body, or page exception.
    return {
      status: "unknown",
      diagnostic: signal.aborted
        ? "AUTH_TIMEOUT_OR_CANCELLED"
        : "AUTH_QUERY_FAILED",
    };
  }
}

/** One document-owned, single-flight query slot; it does not poll the server. */
export function createAuthenticationCheck() {
  let id = 0;
  let revision = 0;
  let storageReadFailed = false;
  // Storage-denied pages previously returned unknown from the query. Sampling
  // must preserve that behavior rather than preventing the bootstrap entirely.
  function readCredential() {
    try {
      const raw = window.localStorage.getItem("userToken");
      storageReadFailed = false;
      return raw;
    } catch {
      if (!storageReadFailed)
        console.warn("[uXS DeepSeek authentication] AUTH_STORAGE_READ_FAILED");
      storageReadFailed = true;
      return undefined;
    }
  }
  let credential = readCredential();
  let pending = false;
  let closed = false;
  /** @type {AbortController|null} */
  let abort = null;
  /** @type {Authentication} */
  let result = { status: "checking", diagnostic: null };
  return {
    revision() {
      return revision;
    },
    // Bootstrap's existing route timer observes local identity changes; this
    // does not query the server or export the stored credential.
    observeCredentials() {
      if (closed) return;
      const next = readCredential();
      if (next === credential) return;
      credential = next;
      revision++;
      id++;
      abort?.abort();
      pending = false;
      result = { status: "checking", diagnostic: "CREDENTIAL_CHANGED" };
    },
    start() {
      if (closed || pending) return id;
      id++;
      pending = true;
      const current = id;
      result = { status: "checking", diagnostic: null };
      abort = new AbortController();
      const request = abort;
      const timer = window.setTimeout(() => request.abort(), 8000);
      void queryAuthentication(request.signal).then((next) => {
        window.clearTimeout(timer);
        if (closed || current !== id) return;
        result = next;
        pending = false;
      });
      return id;
    },
    /** @param {number} expected @returns {Authentication} */
    read(expected) {
      return expected === id && !closed
        ? result
        : { status: "unknown", diagnostic: "AUTH_CHECK_SUPERSEDED" };
    },
    close() {
      closed = true;
      abort?.abort();
    },
  };
}
