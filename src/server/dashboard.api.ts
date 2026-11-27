import type { Database } from "bun:sqlite";
import { DEFAULT_TIER_MODELS } from "../config/config.store.ts";
import * as repo from "../db/dashboard.repository.ts";
import { costByDayModel, totals, usageBy, type StatsFilter } from "../db/stats.repository.ts";
import { contextWindow } from "./context.window.ts";
import { filter, HTTP, HttpError, pageQuery, sessionQuery } from "./dashboard.params.ts";
import type { ApiError, DashboardMeta, LiveSession, Overview, SessionDetail } from "./dashboard.types.ts";

/** Port the dashboard listens on unless config or --port says otherwise. */
export const DEFAULT_DASHBOARD_PORT = 5757;
/** How often the running dashboard re-imports new transcript bytes. */
export const SYNC_INTERVAL_MS = 5000;
/** Max sessions returned by /api/live. */
export const LIVE_LIMIT = 20;
/** A session is live if its last entry is at most this many minutes old. */
export const LIVE_WINDOW_MIN = 15;

const DAY_LIMIT = 90;
const BREAKDOWN_LIMIT = 50;
const MINUTE_MS = 60_000;
const ALLOWED_HOSTS = ["127.0.0.1", "localhost"];

/** Supplies /api/meta; without one the endpoint reports "never synced" and the default tier models. */
export type MetaProvider = () => DashboardMeta;

const NO_META: MetaProvider = () => ({ synced_at: null, changed_at: null, error: null, interval_ms: SYNC_INTERVAL_MS, tiers: DEFAULT_TIER_MODELS });

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error } satisfies ApiError, status);

/** Window `since..until` of equal length right before `f.since`; null for all-time (since = epoch 0). */
function prevFilter(f: StatsFilter, now: number): StatsFilter | null {
  const since = Date.parse(f.since);
  if (since <= 0) return null;
  return { ...f, since: new Date(since - (now - since)).toISOString(), until: f.since };
}

/** Overview for the filter window, with the previous window's totals for deltas. */
export function overview(db: Database, f: StatsFilter, now = Date.now()): Overview {
  const prev = prevFilter(f, now);
  return {
    since: f.since,
    total: totals(db, f),
    prev: prev && totals(db, prev),
    byDay: usageBy(db, "day", f, DAY_LIMIT),
    byDayModel: costByDayModel(db, f, DAY_LIMIT),
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

function route(db: Database, url: URL, meta: MetaProvider): unknown {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/overview") return overview(db, filter(url));
  if (path === "/api/projects") return repo.projectsPage(db, filter(url), pageQuery(url));
  if (path === "/api/sessions") return repo.sessionsPage(db, filter(url), pageQuery(url), sessionQuery(url));
  if (path === "/api/roles") return repo.rolesPage(db, filter(url), pageQuery(url));
  if (path === "/api/live") return live(db);
  if (path === "/api/meta") return meta();
  const m = /^\/api\/sessions\/([^/]+)(\/timeline)?$/.exec(path);
  if (m) return m[2] ? timeline(db, m[1]!, url) : sessionDetail(db, m[1]!);
  throw new HttpError(HTTP.notFound, `unknown endpoint ${path}`);
}

/** Serves the read-only dashboard JSON API; undefined for non-/api paths. */
export function handleApi(req: Request, db: Database, port = DEFAULT_DASHBOARD_PORT, meta: MetaProvider = NO_META): Response | undefined {
  const url = new URL(req.url);
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return undefined;
  // DNS rebinding guard: a foreign page resolving its own name to 127.0.0.1 still sends its own Host.
  // Bun.serve builds req.url from Host, so url.host is the fallback when the header is absent.
  const host = req.headers.get("host") ?? url.host;
  if (!ALLOWED_HOSTS.some((h) => host === `${h}:${port}`)) return fail(HTTP.forbidden, "forbidden host");
  if (req.method !== "GET") return fail(HTTP.notAllowed, "method not allowed");
  try {
    return json(route(db, url, meta));
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    throw err;
  }
}
