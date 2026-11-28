import type { ApiError } from "../../server/dashboard.types.ts";
import type { SessionInfo } from "../../server/agents.types.ts";

/** A failed write: carries method, path, HTTP status and the server's `error` message. */
export class ApiWriteError extends Error {
  constructor(readonly method: string, readonly path: string, readonly status: number, readonly serverMessage: string) {
    super(`${method} ${path} failed (${status}): ${serverMessage}`);
    this.name = "ApiWriteError";
  }
}

let session: SessionInfo | null = null;

/** Fetches `GET /api/session` and caches it for later writes. */
export async function loadSession(): Promise<SessionInfo> {
  const res = await fetch("/api/session", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/session failed (${res.status}): ${res.statusText}`);
  session = (await res.json()) as SessionInfo;
  return session;
}

/** Cached session, or null before `loadSession` has resolved. */
export const getSession = (): SessionInfo | null => session;

/** Test hook: drops the cached session. */
export const resetSession = (): void => { session = null; };

const send = (method: string, path: string, body: unknown, etag: string, token: string | null) =>
  fetch(path, {
    method,
    headers: { "If-Match": etag, ...(token ? { "X-CM-Token": token } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Sends a guarded write; on 403 "invalid token" re-fetches the session once and retries once. Non-2xx throws ApiWriteError. */
export async function sendJson<T>(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown | undefined, etag: string): Promise<T> {
  const run = async () => {
    try {
      return await send(method, path, body, etag, (session ?? (await loadSession())).token);
    } catch (err) {
      throw new Error(`${method} ${path} failed: network error (${(err as Error).message})`, { cause: err });
    }
  };
  let res = await run();
  let err = res.ok ? null : ((await res.json().catch(() => null)) as ApiError | null);
  if (res.status === 403 && /token/i.test(err?.error ?? "")) {
    await loadSession();
    res = await run();
    err = res.ok ? null : ((await res.json().catch(() => null)) as ApiError | null);
  }
  if (!res.ok) throw new ApiWriteError(method, path, res.status, err?.error ?? res.statusText);
  return (await res.json()) as T;
}
