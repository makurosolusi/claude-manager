import { SESSION_SORTS, type SessionSort } from "../../server/dashboard.types.ts";
import type { SortDir } from "@/components/data.table.tsx";
import { hashHref } from "@/lib/hash.route.ts";
import { DEFAULT_RANGE, type Range } from "@/lib/range.ts";

/** Sessions route path; the detail page lives at `${SESSIONS_PATH}/<id>`. */
export const SESSIONS_PATH = "/sessions";
/** Default order: most recently active first. */
export const DEFAULT_SESSION_SORT: SessionSort = "last";
/** Default sort direction. */
export const DEFAULT_SESSION_DIR: SortDir = "desc";
/** Server rejects longer `q` with 400 (see dashboard.params.ts); clip before it gets there. */
export const SEARCH_MAX_CHARS = 200;

/** Sessions list state as kept in the URL hash. */
export interface SessionsState {
  q: string;
  sort: SessionSort;
  dir: SortDir;
  project: string;
  page: number;
}

const isSort = (v: string | null): v is SessionSort => v !== null && (SESSION_SORTS as readonly string[]).includes(v);

/** Reads list state from hash params; unknown or missing values fall back to defaults. */
export function parseSessionsQuery(params: URLSearchParams): SessionsState {
  const sort = params.get("sort");
  const dir = params.get("dir");
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").trim().slice(0, SEARCH_MAX_CHARS),
    sort: isSort(sort) ? sort : DEFAULT_SESSION_SORT,
    dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_SESSION_DIR,
    project: params.get("project") ?? "",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Hash link for list state + range; default values are left out so URLs stay short. */
export function sessionsHref(s: SessionsState, range: Range): string {
  return hashHref(SESSIONS_PATH, {
    range: range === DEFAULT_RANGE ? undefined : range,
    q: s.q.trim().slice(0, SEARCH_MAX_CHARS) || undefined,
    sort: s.sort === DEFAULT_SESSION_SORT ? undefined : s.sort,
    dir: s.dir === DEFAULT_SESSION_DIR ? undefined : s.dir,
    project: s.project || undefined,
    page: s.page > 1 ? String(s.page) : undefined,
  });
}
