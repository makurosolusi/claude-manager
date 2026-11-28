import type { Route } from "@/lib/hash.route.ts";
import { hashHref } from "@/lib/hash.route.ts";

/** Tabs of the session detail page; the first one is the default and is left out of the URL. */
export const SESSION_TABS = ["requests", "agents", "prompts"] as const;
export type SessionTab = (typeof SESSION_TABS)[number];

/** Active tab from `?tab=`; unknown or missing values fall back to Requests. */
export const parseTab = (v: string | null): SessionTab => SESSION_TABS.find((t) => t === v) ?? SESSION_TABS[0];

/** Link to `tab` on the same page. Each tab owns its own table params (q, page, sort, facets), so only `range` carries over. */
export function tabHref(route: Route, tab: SessionTab): string {
  return hashHref(route.path, { range: route.params.get("range") ?? undefined, tab: tab === SESSION_TABS[0] ? undefined : tab });
}

/** Next tab for an arrow/Home/End key (wraps around); null for any other key. */
export function tabForKey(current: SessionTab, key: string): SessionTab | null {
  const i = SESSION_TABS.indexOf(current);
  const n = SESSION_TABS.length;
  if (key === "ArrowRight") return SESSION_TABS[(i + 1) % n]!;
  if (key === "ArrowLeft") return SESSION_TABS[(i - 1 + n) % n]!;
  if (key === "Home") return SESSION_TABS[0];
  if (key === "End") return SESSION_TABS[n - 1]!;
  return null;
}
