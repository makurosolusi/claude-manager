import { CliError } from "../cli.error.ts";
import { parseSince } from "../commands/stats.command.ts";
import type { PageQuery } from "../db/dashboard.repository.ts";
import type { StatsFilter } from "../db/stats.repository.ts";
import { SESSION_SORTS, type SessionQuery, type SessionSort } from "./dashboard.types.ts";

const DEFAULT_SINCE = "30d";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_QUERY_CHARS = 200;
const SORT_DIRS = ["asc", "desc"] as const;

/** HTTP statuses the dashboard API answers with on client errors. */
export const HTTP = { badRequest: 400, forbidden: 403, notFound: 404, notAllowed: 405 } as const;

/** Client error mapped straight to an HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new HttpError(HTTP.badRequest, message);

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

/** `since` / `project` query params as a StatsFilter. */
export function filter(url: URL): StatsFilter {
  try {
    return { since: parseSince(url.searchParams.get("since") ?? DEFAULT_SINCE), project: url.searchParams.get("project") || undefined };
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
