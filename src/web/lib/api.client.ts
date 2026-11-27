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

/** Result of `useApi`: data, error and loading flag. `loading` is true only while there is nothing to show yet (first load or a new resource); a background refresh keeps `data` and leaves `loading` false. */
export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Query params that slide on every refresh (e.g. the range's lower bound) and so don't identify the resource. */
const VOLATILE_PARAMS = ["since"];

/** `url` without its volatile params: two URLs with the same identity are the same resource, refreshed. */
export function identityOf(url: string): string {
  const i = url.indexOf("?");
  if (i < 0) return url;
  const params = new URLSearchParams(url.slice(i + 1));
  for (const k of VOLATILE_PARAMS) params.delete(k);
  return params.size ? `${url.slice(0, i)}?${params}` : url.slice(0, i);
}

/** Whether to show a skeleton: only when the resource is active and nothing (data or error) is loaded for it yet. */
export function isLoading(cur: { data: unknown; error: unknown } | undefined, active: boolean): boolean {
  return active && (!cur || (cur.data === undefined && cur.error === undefined));
}

/** `prev` when `next` is structurally identical JSON, so identical refreshes don't re-render; Errors never match. */
export function keepRef<V>(prev: V | undefined, next: V): V {
  if (prev === undefined || prev instanceof Error || next instanceof Error) return next;
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

/** What to show for a fetched result: kept only while it belongs to the resource (path + query) now requested; a tick refresh keeps it. */
export function visibleFor<S extends { key: string }>(state: S, key: string): S | undefined {
  return state.key === key ? state : undefined;
}

/** Fetches `path` whenever it, `query`, or `tick` changes (stale-while-revalidate): a refresh of the same resource keeps the old data until the new lands; a different resource (path or query, ignoring the sliding `since`) drops it. A `null` path skips the fetch. */
export function useApi<T>(path: string | null, query: Query = {}, tick = 0): ApiState<T> {
  const url = path === null ? "" : withQuery(path, query);
  const key = identityOf(url);
  const [state, setState] = useState<{ key: string; data: T | undefined; error: Error | undefined }>({ key, data: undefined, error: undefined });
  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    getJson<T>(path, query, ctrl.signal).then(
      (data) => setState((s) => {
        const d = keepRef(s.key === key ? s.data : undefined, data);
        return s.key === key && !s.error && d === s.data ? s : { key, data: d, error: undefined };
      }),
      (error: unknown) => {
        if (ctrl.signal.aborted) return; // superseded by a newer request; its result will land instead
        setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: error instanceof Error ? error : new Error(String(error)) }));
      },
    );
    return () => ctrl.abort();
  }, [url, tick]);
  // The effect runs after the render that changed the key; hide the old resource's data in that render too.
  const cur = path === null ? undefined : visibleFor(state, key);
  return { data: cur?.data, error: cur?.error, loading: isLoading(cur, path !== null) };
}

/** Fetches every full URL (results keyed by URL; an Error value marks a failed one, a missing key is still loading). Results of resources no longer requested are dropped; the rest stay (even across a sliding `since`) until the refetch replaces them. */
export function useApiMany<T>(urls: readonly string[], tick = 0): Record<string, T | Error> {
  const [res, setRes] = useState<Record<string, T | Error>>({}); // keyed by identityOf(url)
  const sig = urls.join("\n");
  useEffect(() => {
    const ctrl = new AbortController();
    const ids = new Set(urls.map(identityOf));
    setRes((r) => (Object.keys(r).every((k) => ids.has(k)) ? r : Object.fromEntries(Object.entries(r).filter(([k]) => ids.has(k)))));
    for (const u of urls) {
      const id = identityOf(u);
      const put = (v: T | Error) => setRes((r) => { const k = keepRef(r[id], v); return k === r[id] ? r : { ...r, [id]: k }; });
      getJson<T>(u, {}, ctrl.signal).then(put, (e: unknown) => {
        if (!ctrl.signal.aborted) put(e instanceof Error ? e : new Error(String(e)));
      });
    }
    return () => ctrl.abort();
  }, [sig, tick]);
  return Object.fromEntries(urls.filter((u) => identityOf(u) in res).map((u) => [u, res[identityOf(u)]!]));
}
