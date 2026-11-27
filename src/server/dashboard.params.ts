import { CliError } from "../cli.error.ts";
import { parseSince } from "../commands/stats.command.ts";
import type { PageQuery } from "../db/dashboard.repository.ts";
import type { SessionFilter } from "../db/sessions.repository.ts";
import type { StatsFilter } from "../db/stats.repository.ts";
import { FAMILIES, SESSION_GROUPS, SESSION_SORTS, SESSION_STATUSES, type SessionGroupBy, type SessionQuery, type SessionSort } from "./dashboard.types.ts";
import { bad, enumParam, HTTP, HttpError, listParam } from "./filter.params.ts";

const DEFAULT_SINCE = "30d";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_QUERY_CHARS = 200;
const SORT_DIRS = ["asc", "desc"] as const;

export { bad, HTTP, HttpError };

function intParam(url: URL, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > max) throw bad(`invalid ${name} "${raw}": use an integer from 1 to ${max}`);
  return n;
}

/** `page` / `pageSize` query params, validated. */
export const pageQuery = (url: URL): PageQuery => ({
  page: intParam(url, "page", 1),
  pageSize: intParam(url, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
});

/** `since` plus repeatable exact `project` query params as a StatsFilter. */
export function filter(url: URL): StatsFilter {
  try {
    return { since: parseSince(url.searchParams.get("since") ?? DEFAULT_SINCE), projects: listParam(url, "project") };
  } catch (err) {
    if (err instanceof CliError) throw bad(err.message.replace("--since", "since"));
    throw err;
  }
}

const oneOf = <T extends string>(values: readonly T[], raw: string): raw is T => (values as readonly string[]).includes(raw);

/** `sort` / `dir` / `q` query params for /api/sessions; defaults to newest first. */
export function sessionQuery(url: URL): SessionQuery {
  const sort = url.searchParams.get("sort") ?? "last";
  const dir = url.searchParams.get("dir") ?? "desc";
  const q = url.searchParams.get("q")?.trim();
  if (!oneOf<SessionSort>(SESSION_SORTS, sort)) throw bad(`invalid sort "${sort}": use one of ${SESSION_SORTS.join(", ")}`);
  if (!oneOf(SORT_DIRS, dir)) throw bad(`invalid dir "${dir}": use one of ${SORT_DIRS.join(", ")}`);
  if (q && q.length > MAX_QUERY_CHARS) throw bad(`invalid q: use at most ${MAX_QUERY_CHARS} characters`);
  return { sort, dir, q: q || undefined };
}

/** Sessions filter: `filter()` plus repeatable `family` / `role` / `status`. */
export const sessionFilter = (url: URL): SessionFilter => ({
  ...filter(url),
  families: listParam(url, "family", FAMILIES),
  roles: listParam(url, "role"),
  statuses: listParam(url, "status", SESSION_STATUSES),
});

/** `by` param of /api/sessions/groups; required. */
export const sessionGroupBy = (url: URL): SessionGroupBy => enumParam(url, "by", SESSION_GROUPS);

/** True for `facets=1`. */
export const wantsFacets = (url: URL) => url.searchParams.get("facets") === "1";
