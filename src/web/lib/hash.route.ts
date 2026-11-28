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

/** How a hashchange was reached: a new entry (link click, `location.hash =`), or a Back / Forward traversal. */
export type NavKind = "push" | "back" | "forward";

/** Decides whether leaving `prev` for `next` must be held; returns true to block. */
export type NavBlocker = (prev: string, next: string, kind: NavKind) => boolean;

/** Classifies a hashchange from the index stamped on history entries: an unstamped entry is a fresh push, a lower index is Back, a higher one Forward. */
export const navKind = (idx: number | undefined, current: number): NavKind => (idx === undefined || idx === current ? "push" : idx < current ? "back" : "forward");

/**
 * History move that puts the user back on the entry they were blocked from leaving. Traversals are undone by the opposite traversal and
 * a push by going back over it: unlike `replaceState(committed)`, this never overwrites the neighbouring entry's URL.
 */
export const restoreStep = (kind: NavKind): "back" | "forward" => (kind === "back" ? "forward" : "back");

/** How to complete a held navigation after Discard: repeat the traversal, or assign the hash for a push (which also drops the dangling entry). */
export const proceedStep = (kind: NavKind): "back" | "forward" | "assign" => (kind === "push" ? "assign" : kind);

// Single slot: only one editor (the agent form) guards navigation at a time. ponytail: make it a set if two guards ever coexist.
let blocker: NavBlocker | null = null;

/** Registers the active blocker (replacing any previous one); returns an unregister that only clears its own registration. */
export function registerNavBlocker(fn: NavBlocker): () => void {
  blocker = fn;
  return () => { if (blocker === fn) blocker = null; };
}

/** True when the registered blocker vetoes `prev` -> `next`; with no blocker nothing is ever blocked. */
export const isNavBlocked = (prev: string, next: string, kind: NavKind = "push"): boolean => blocker?.(prev, next, kind) ?? false;

const stampOf = (): number | undefined => {
  const idx = (history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : undefined;
};
const stamp = (idx: number) => history.replaceState({ idx }, "");

/**
 * Current hash route, updated on `hashchange`. A registered blocker can veto a change: the history move is undone with `restoreStep`
 * and the page stays put. Entries are stamped with an index (`history.state.idx`) because `hashchange` alone cannot tell Back from a link click.
 * ponytail: `location.replace` to a new hash looks like a push; fine while only clean pages use it.
 */
export function useHashRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    let committed = location.hash;
    let at = stampOf() ?? 0;
    if (stampOf() === undefined) stamp(at);
    const onChange = () => {
      const next = location.hash;
      if (next === committed) return; // also the echo of our own restore
      const idx = stampOf();
      const kind = navKind(idx, at);
      if (isNavBlocked(committed, next, kind)) {
        history[restoreStep(kind)]();
        return;
      }
      committed = next;
      at = idx ?? at + 1;
      if (idx === undefined) stamp(at);
      setHash(next);
    };
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}
