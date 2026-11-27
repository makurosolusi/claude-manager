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

/** Builds a hash link, dropping empty params. */
export function hashHref(path: string, params: Record<string, string | undefined> = {}): string {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return `#${path}${qs.size ? `?${qs}` : ""}`;
}

/** Href for `route` with `patch` applied; other params are kept, and empty/undefined patch values remove the key. */
export function withParams(route: Route, patch: Record<string, string | undefined>): string {
  const params = new URLSearchParams(route.params);
  for (const [k, v] of Object.entries(patch)) {
    if (v) params.set(k, v);
    else params.delete(k);
  }
  return `#${route.path}${params.size ? `?${params}` : ""}`;
}

/** Current hash route, updated on `hashchange`. */
export function useHashRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}
