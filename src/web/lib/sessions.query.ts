import { FAMILIES, SESSION_GROUPS, SESSION_SORTS, SESSION_STATUSES } from "../../server/dashboard.types.ts";
import { withQuery, type Query } from "@/lib/api.client.ts";
import { plural } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { DEFAULT_RANGE, type Range } from "@/lib/range.ts";
import { NO_GROUP, tableParams, type TableSpec, type TableState } from "@/lib/table.query.ts";

/** Sessions route path; the detail page lives at `${SESSIONS_PATH}/<id>`. */
export const SESSIONS_PATH = "/sessions";
/** Facet ids; each doubles as the URL key and the API filter param. */
export const SESSION_FACET_IDS = ["project", "family", "role", "status"] as const;

/** URL contract of the sessions table. */
export const SESSIONS_SPEC: TableSpec = {
  sorts: SESSION_SORTS,
  defaultSort: "last",
  defaultDir: "desc",
  groups: [NO_GROUP, ...SESSION_GROUPS],
  facets: { project: "free", family: FAMILIES, role: "free", status: SESSION_STATUSES },
};

/** One group to expand: its dimension (`by`) and value (`key`). */
export interface GroupRef { by: string; key: string }

/** Endpoint path and query of `/api/sessions[/groups]` for the table state; `only` narrows the list to one group's rows. Pass both to `useApi` so a changed query on the same endpoint keeps the old data (dimmed) instead of a skeleton. */
export function sessionsApi(since: string, s: TableState, o: { groups?: boolean; facets?: boolean; size?: number; only?: GroupRef; range?: Range } = {}): { path: string; query: Query } {
  // `range` is ignored by the server; it makes a range change a new resource for useApi while a sliding `since` stays a refresh.
  const q: Query = { since, range: o.range, q: s.q || undefined };
  for (const id of SESSION_FACET_IDS) q[id] = o.only?.by === id ? [o.only.key] : (s.filters[id] ?? []);
  if (o.groups) return { path: "/api/sessions/groups", query: { ...q, by: s.group } };
  return { path: "/api/sessions", query: { ...q, sort: s.sort, dir: s.dir, page: o.only ? 1 : s.page, pageSize: o.size ?? s.size, facets: o.facets ? 1 : undefined } };
}

/** Same as `sessionsApi` as one URL string (the key of `useApiMany` results). */
export function sessionsApiPath(since: string, s: TableState, o: Parameters<typeof sessionsApi>[2] = {}): string {
  const { path, query } = sessionsApi(since, s, o);
  return withQuery(path, query);
}

/** Hash link for table state + range; defaults are left out so URLs stay short. */
export function sessionsHref(s: TableState, range: Range): string {
  return hashHref(SESSIONS_PATH, { range: range === DEFAULT_RANGE ? undefined : range, ...tableParams(s, SESSIONS_SPEC) });
}

/** Subtitle count: "—" on error so a stale total from the last good fetch is never shown. */
export function sessionsCountLabel(total: number | undefined, failed: boolean): string {
  if (failed) return "—";
  if (total === undefined) return "Loading…";
  return plural(total, "session");
}
