import { useEffect, useState } from "react";
import type { ApiError } from "../../server/dashboard.types.ts";

/** Rows per page for every paginated table (server caps pageSize at 200). */
export const PAGE_SIZE = 50;

export type Query = Record<string, string | number | undefined>;

/** GETs a dashboard API path and parses JSON; non-2xx responses throw with the server's `{error}` message. */
export async function getJson<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const url = params.size ? `${path}?${params}` : path;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    // A non-JSON error body (e.g. proxy page) falls back to statusText; the request still throws below.
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(`GET ${path} failed (${res.status}): ${body?.error ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Fetches `path` whenever it, `query`, or `tick` changes; keeps the previous data while reloading. */
export function useApi<T>(path: string, query: Query = {}, tick = 0): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: undefined, error: undefined, loading: true });
  const key = JSON.stringify(query);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    getJson<T>(path, query, ctrl.signal).then(
      (data) => setState({ data, error: undefined, loading: false }),
      (error: unknown) => {
        if (ctrl.signal.aborted) return; // superseded by a newer request; its result will land instead
        setState((s) => ({ ...s, error: error instanceof Error ? error : new Error(String(error)), loading: false }));
      },
    );
    return () => ctrl.abort();
  }, [path, key, tick]);
  return state;
}
