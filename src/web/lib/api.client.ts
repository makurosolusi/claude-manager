import { useEffect, useState } from "react";
import type { ApiError } from "../../server/dashboard.types.ts";

/** Rows per page for every paginated table (server caps pageSize at 200). */
export const PAGE_SIZE = 50;

/** Query values; an array repeats the key (`a=1&a=2`), empty values are dropped. */
export type Query = Record<string, string | number | readonly string[] | undefined>;

/** `path` with `query` appended; arrays become repeated keys, undefined and empty strings are skipped. */
export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === "object") for (const item of v) params.append(k, item);
    else if (v !== undefined && v !== "") params.set(k, String(v));
  }
  return params.size ? `${path}?${params}` : path;
}

/** GETs a dashboard API path and parses JSON; non-2xx responses throw with the server's `{error}` message. */
export async function getJson<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
  const url = withQuery(path, query);
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    // Aborts are expected (superseded request); rethrow untouched so callers can still recognise them.
    if (signal?.aborted) throw err;
    // Network failures arrive as a bare "Failed to fetch"; name the endpoint so the UI error is actionable.
    throw new Error(`GET ${path} failed: network error (${(err as Error).message})`, { cause: err });
  }
  if (!res.ok) {
    // A non-JSON error body (e.g. proxy page) falls back to statusText; the request still throws below.
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(`GET ${path} failed (${res.status}): ${body?.error ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Result of `useApi`: data, error and loading flag. */
export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** What to show for a fetched result: kept only while it belongs to the resource (path + query) now requested; a tick refresh keeps it. */
export function visibleFor<S extends { key: string }>(state: S, key: string): S | undefined {
  return state.key === key ? state : undefined;
}

/** Fetches `path` whenever it, `query`, or `tick` changes; keeps the previous data while reloading the same resource, drops it when the path or query changes. A `null` path skips the fetch. */
export function useApi<T>(path: string | null, query: Query = {}, tick = 0): ApiState<T> {
  const key = path === null ? "" : withQuery(path, query);
  const [state, setState] = useState<ApiState<T> & { key: string }>({ key, data: undefined, error: undefined, loading: path !== null });
  useEffect(() => {
    if (path === null) {
      setState((s) => (s.loading ? { ...s, loading: false } : s));
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...(s.key === key ? s : { key, data: undefined, error: undefined }), loading: true }));
    getJson<T>(path, query, ctrl.signal).then(
      (data) => setState({ key, data, error: undefined, loading: false }),
      (error: unknown) => {
        if (ctrl.signal.aborted) return; // superseded by a newer request; its result will land instead
        setState((s) => ({ ...(s.key === key ? s : { key, data: undefined }), error: error instanceof Error ? error : new Error(String(error)), loading: false }));
      },
    );
    return () => ctrl.abort();
  }, [key, tick]);
  // The effect runs after the render that changed the key; hide the old resource's data in that render too.
  const cur = visibleFor(state, key);
  return cur ?? { data: undefined, error: undefined, loading: path !== null };
}

/** Fetches every full URL (results keyed by URL; an Error value marks a failed one, a missing key is still loading). Results of URLs no longer requested are dropped; the rest stay while refetching. */
export function useApiMany<T>(urls: readonly string[], tick = 0): Record<string, T | Error> {
  const [res, setRes] = useState<Record<string, T | Error>>({});
  const sig = urls.join("\n");
  useEffect(() => {
    const ctrl = new AbortController();
    setRes((r) => Object.fromEntries(Object.entries(r).filter(([u]) => urls.includes(u))));
    for (const u of urls) {
      getJson<T>(u, {}, ctrl.signal).then(
        (v) => setRes((r) => ({ ...r, [u]: v })),
        (e: unknown) => {
          if (!ctrl.signal.aborted) setRes((r) => ({ ...r, [u]: e instanceof Error ? e : new Error(String(e)) }));
        },
      );
    }
    return () => ctrl.abort();
  }, [sig, tick]);
  return Object.fromEntries(urls.filter((u) => u in res).map((u) => [u, res[u]!]));
}
