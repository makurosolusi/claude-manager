import { useEffect, useState } from "react";

export interface Route {
  /** Path after "#", e.g. "/sessions/abc". */
  path: string;
  params: URLSearchParams;
}

/** Parses a location hash such as "#/sessions?project=x" into path + query params. */
export function parseHash(hash: string): Route {
  const [path = "", qs = ""] = hash.replace(/^#/, "").split("?");
  return { path: path || "/", params: new URLSearchParams(qs) };
}

/** Param values: a string, or a string[] written as repeated keys (`family=a&family=b`). */
export type ParamValue = string | string[] | undefined;

const setParam = (params: URLSearchParams, k: string, v: ParamValue) => {
  params.delete(k);
  for (const x of Array.isArray(v) ? v : [v]) if (x) params.append(k, x);
};

/** Builds a hash link, dropping empty params. */
export function hashHref(path: string, params: Record<string, ParamValue> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) setParam(qs, k, v);
  return `#${path}${qs.size ? `?${qs}` : ""}`;
}

/** Href for `route` with `patch` applied; other params are kept, and empty/undefined patch values remove the key. */
export function withParams(route: Route, patch: Record<string, ParamValue>): string {
  const params = new URLSearchParams(route.params);
  for (const [k, v] of Object.entries(patch)) setParam(params, k, v);
  return `#${route.path}${params.size ? `?${params}` : ""}`;
}

/** Decides whether leaving `prev` for `next` must be held; returns true to block. */
export type NavBlocker = (prev: string, next: string) => boolean;

// Single slot: only one editor (the agent form) guards navigation at a time. ponytail: make it a set if two guards ever coexist.
let blocker: NavBlocker | null = null;

/** Registers the active blocker (replacing any previous one); returns an unregister that only clears its own registration. */
export function registerNavBlocker(fn: NavBlocker): () => void {
  blocker = fn;
  return () => { if (blocker === fn) blocker = null; };
}

/** True when the registered blocker vetoes `prev` -> `next`; with no blocker nothing is ever blocked. */
export const isNavBlocked = (prev: string, next: string): boolean => blocker?.(prev, next) ?? false;

/** Current hash route, updated on `hashchange`. A registered blocker can veto a change: the previous hash is restored and the page stays put. */
export function useHashRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    let committed = location.hash;
    const onChange = () => {
      const next = location.hash;
      if (next === committed) return;
      if (isNavBlocked(committed, next)) {
        // Restore without firing another hashchange; the blocker already holds `next`.
        history.replaceState(null, "", committed || "#/");
        return;
      }
      committed = next;
      setHash(next);
    };
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}
