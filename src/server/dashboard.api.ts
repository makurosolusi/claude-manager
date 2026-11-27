import type { Database } from "bun:sqlite";
import { CliError } from "../cli.error.ts";
import { parseSince } from "../commands/stats.command.ts";
import * as repo from "../db/dashboard.repository.ts";
import { usageBy, usageTotal, type StatsFilter } from "../db/stats.repository.ts";
import { contextWindow } from "./context.window.ts";
import type { ApiError, LiveSession, Overview, SessionDetail } from "./dashboard.types.ts";

/** Port the dashboard listens on unless config or --port says otherwise. */
export const DEFAULT_DASHBOARD_PORT = 5757;
/** Max sessions returned by /api/live. */
export const LIVE_LIMIT = 20;
/** A session is live if its last entry is at most this many minutes old. */
export const LIVE_WINDOW_MIN = 15;

const DEFAULT_SINCE = "30d";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DAY_LIMIT = 90;
const BREAKDOWN_LIMIT = 50;
const MINUTE_MS = 60_000;
const ALLOWED_HOSTS = ["127.0.0.1", "localhost"];

const HTTP = { badRequest: 400, forbidden: 403, notFound: 404, notAllowed: 405 } as const;

/** Client error mapped straight to an HTTP status. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error } satisfies ApiError, status);

function intParam(url: URL, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > max) throw new HttpError(HTTP.badRequest, `invalid ${name} "${raw}": use an integer from 1 to ${max}`);
  return n;
}

const pageQuery = (url: URL): repo.PageQuery => ({
  page: intParam(url, "page", 1),
  pageSize: intParam(url, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
});

function filter(url: URL): StatsFilter {
  try {
    return { since: parseSince(url.searchParams.get("since") ?? DEFAULT_SINCE), project: url.searchParams.get("project") || undefined };
  } catch (err) {
    if (err instanceof CliError) throw new HttpError(HTTP.badRequest, err.message.replace("--since", "since"));
    throw err;
  }
}

function overview(db: Database, f: StatsFilter): Overview {
  return {
    since: f.since,
    total: usageTotal(db, f),
    byDay: usageBy(db, "day", f, DAY_LIMIT),
    byModel: usageBy(db, "model", f, BREAKDOWN_LIMIT),
    byRole: usageBy(db, "role", f, BREAKDOWN_LIMIT),
  };
}

function sessionDetail(db: Database, id: string): SessionDetail {
  const session = repo.sessionById(db, id);
  if (!session) throw new HttpError(HTTP.notFound, "session not found");
  return { session, agents: repo.sessionAgents(db, id) };
}

function timeline(db: Database, id: string, url: URL) {
  const p = pageQuery(url);
  if (!repo.sessionById(db, id)) throw new HttpError(HTTP.notFound, "session not found");
  return repo.timelinePage(db, id, p);
}

function live(db: Database, now = Date.now()): LiveSession[] {
  const cutoff = new Date(now - LIVE_WINDOW_MIN * MINUTE_MS).toISOString();
  return repo.liveSessions(db, cutoff, LIVE_LIMIT).map(({ max_context, ...s }) => {
    const window = contextWindow(s.model, max_context);
    return { ...s, context_window: window, context_left_pct: Math.max(0, Math.round((1 - s.context_used / window) * 100)) };
  });
}

function route(db: Database, url: URL): unknown {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/overview") return overview(db, filter(url));
  if (path === "/api/projects") return repo.projectsPage(db, filter(url), pageQuery(url));
  if (path === "/api/sessions") return repo.sessionsPage(db, filter(url), pageQuery(url));
  if (path === "/api/roles") return repo.rolesPage(db, filter(url), pageQuery(url));
  if (path === "/api/live") return live(db);
  const m = /^\/api\/sessions\/([^/]+)(\/timeline)?$/.exec(path);
  if (m) return m[2] ? timeline(db, m[1]!, url) : sessionDetail(db, m[1]!);
  throw new HttpError(HTTP.notFound, `unknown endpoint ${path}`);
}

/** Serves the read-only dashboard JSON API; undefined for non-/api paths. */
export function handleApi(req: Request, db: Database, port = DEFAULT_DASHBOARD_PORT): Response | undefined {
  const url = new URL(req.url);
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return undefined;
  // DNS rebinding guard: a foreign page resolving its own name to 127.0.0.1 still sends its own Host.
  // Bun.serve builds req.url from Host, so url.host is the fallback when the header is absent.
  const host = req.headers.get("host") ?? url.host;
  if (!ALLOWED_HOSTS.some((h) => host === `${h}:${port}`)) return fail(HTTP.forbidden, "forbidden host");
  if (req.method !== "GET") return fail(HTTP.notAllowed, "method not allowed");
  try {
    return json(route(db, url));
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }
}
