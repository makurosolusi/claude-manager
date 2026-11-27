import type { Database } from "bun:sqlite";
import type { AgentNode, Page, ProjectRow, RoleRow, SessionRow, TimelineItem } from "../server/dashboard.types.ts";
import { KEY, WHERE, type StatsFilter } from "./stats.repository.ts";

/** Page window: 1-based page number and its size. */
export type PageQuery = { page: number; pageSize: number };

type Params = Record<string, string | number | null>;

// COALESCE/IS NOT NULL keep totals at 0 for LEFT-joined rows with no requests.
const USAGE = `COUNT(r.message_id) AS requests, COALESCE(SUM(r.input), 0) AS input,
  COALESCE(SUM(r.cache_5m + r.cache_1h), 0) AS cache_write, COALESCE(SUM(r.cache_read), 0) AS cache_read,
  COALESCE(SUM(r.output), 0) AS output, COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
  COALESCE(SUM(r.message_id IS NOT NULL AND r.cost_usd IS NULL), 0) AS unpriced`;

const CONTEXT = "r.input + r.cache_read + r.cache_5m + r.cache_1h";
const FROM_REQUESTS = "FROM requests r LEFT JOIN agents a ON a.id = r.agent_id LEFT JOIN sessions s ON s.id = r.session_id";
const SESSION_WHERE = "s.last_ts >= $since AND ($project IS NULL OR instr(s.project_cwd, $project) > 0)";
const SESSION_SELECT = `SELECT s.id, s.title, s.project_cwd, s.git_branch, s.main_agent, s.first_ts, s.last_ts,
  (SELECT COUNT(*) FROM agents ag WHERE ag.session_id = s.id) AS agents, ${USAGE}
  FROM sessions s LEFT JOIN requests r ON r.session_id = s.id`;

const filterParams = (f: StatsFilter): Params => ({ since: f.since, project: f.project ?? null });
const pageParams = (p: PageQuery): Params => ({ limit: p.pageSize, offset: (p.page - 1) * p.pageSize });
const splitModels = (m: string | null) => (m ? m.split(",") : []);

function paged<T>(db: Database, p: PageQuery, itemsSql: string, countSql: string, params: Params): Page<T> {
  const items = db.query<T, Params>(itemsSql).all({ ...params, ...pageParams(p) });
  const total = db.query<{ n: number }, Params>(countSql).get(params)!.n;
  return { items, page: p.page, pageSize: p.pageSize, total };
}

/** Usage per project in the filter window, most expensive first. */
export function projectsPage(db: Database, f: StatsFilter, p: PageQuery): Page<ProjectRow> {
  return paged<ProjectRow>(
    db,
    p,
    `SELECT ${KEY.project} AS project, COUNT(DISTINCT r.session_id) AS sessions, MAX(r.ts) AS last_ts, ${USAGE}
      ${FROM_REQUESTS} WHERE ${WHERE} GROUP BY project ORDER BY cost_usd DESC, requests DESC LIMIT $limit OFFSET $offset`,
    `SELECT COUNT(DISTINCT ${KEY.project}) AS n ${FROM_REQUESTS} WHERE ${WHERE}`,
    filterParams(f),
  );
}

/** Sessions active since the filter's start, newest first, with whole-session totals. */
export function sessionsPage(db: Database, f: StatsFilter, p: PageQuery): Page<SessionRow> {
  return paged<SessionRow>(
    db,
    p,
    `${SESSION_SELECT} WHERE ${SESSION_WHERE} GROUP BY s.id ORDER BY s.last_ts DESC, s.id LIMIT $limit OFFSET $offset`,
    `SELECT COUNT(*) AS n FROM sessions s WHERE ${SESSION_WHERE}`,
    filterParams(f),
  );
}

/** One session with whole-session totals (main agent + subagents), or undefined. */
export function sessionById(db: Database, id: string): SessionRow | undefined {
  return db.query<SessionRow, Params>(`${SESSION_SELECT} WHERE s.id = $id GROUP BY s.id`).get({ id }) ?? undefined;
}

type AgentDbRow = Omit<AgentNode, "models"> & { models: string | null };

/** A session's subagents with their own totals; parent is the agent that issued the spawning tool call (NULL = main). */
export function sessionAgents(db: Database, sessionId: string): AgentNode[] {
  return db
    .query<AgentDbRow, Params>(
      `SELECT a.id, tc.agent_id AS parent_agent_id, a.agent_type, a.description, a.spawn_depth, MIN(r.ts) AS first_ts,
        group_concat(DISTINCT r.model) AS models, ${USAGE}
      FROM agents a LEFT JOIN tool_calls tc ON tc.tool_use_id = a.tool_use_id LEFT JOIN requests r ON r.agent_id = a.id
      WHERE a.session_id = $id GROUP BY a.id ORDER BY first_ts IS NULL, first_ts, a.id`,
    )
    .all({ id: sessionId })
    .map((a) => ({ ...a, models: splitModels(a.models) }));
}

type TimelineDbRow = Omit<TimelineItem, "models"> & { models: string | null };

/** Main-agent user prompts, oldest first; each sums every session request (subagents too) until the next prompt. */
export function timelinePage(db: Database, sessionId: string, p: PageQuery): Page<TimelineItem> {
  const page = paged<TimelineDbRow>(
    db,
    p,
    `WITH bounds AS (
        SELECT uuid, ts, source, text, agent_id, LEAD(ts) OVER (ORDER BY ts, uuid) AS next_ts
        FROM prompts WHERE session_id = $id AND agent_id IS NULL
      ), pg AS (SELECT * FROM bounds ORDER BY ts, uuid LIMIT $limit OFFSET $offset)
      SELECT pg.uuid, pg.ts, pg.source, pg.text, pg.agent_id, group_concat(DISTINCT r.model) AS models, ${USAGE}
      FROM pg LEFT JOIN requests r ON r.session_id = $id AND r.ts >= pg.ts AND (pg.next_ts IS NULL OR r.ts < pg.next_ts)
      GROUP BY pg.uuid ORDER BY pg.ts, pg.uuid`,
    "SELECT COUNT(*) AS n FROM prompts WHERE session_id = $id AND agent_id IS NULL",
    { id: sessionId },
  );
  return { ...page, items: page.items.map((t) => ({ ...t, models: splitModels(t.models) })) };
}

/** Usage per (role, model) in the filter window, most expensive first. */
export function rolesPage(db: Database, f: StatsFilter, p: PageQuery): Page<RoleRow> {
  const grouped = `SELECT ${KEY.role} AS role, r.model AS model, ${USAGE} ${FROM_REQUESTS} WHERE ${WHERE} GROUP BY role, model`;
  return paged<RoleRow>(
    db,
    p,
    `${grouped} ORDER BY cost_usd DESC, requests DESC, role, model LIMIT $limit OFFSET $offset`,
    `SELECT COUNT(*) AS n FROM (${grouped})`,
    filterParams(f),
  );
}

/** Raw live-session row before the context window is applied. */
export type LiveDbRow = {
  id: string;
  title: string | null;
  project_cwd: string | null;
  last_ts: string;
  model: string;
  context_used: number;
  max_context: number;
  cost_usd: number;
};

/** Sessions active since `cutoff` (newest first, at most `limit`) with their last main-agent request's context size. */
export function liveSessions(db: Database, cutoff: string, limit: number): LiveDbRow[] {
  return db
    .query<LiveDbRow, Params>(
      `WITH recent AS (
          SELECT id, title, project_cwd, last_ts FROM sessions WHERE last_ts >= $cutoff ORDER BY last_ts DESC LIMIT $limit
        ), main AS (
          SELECT r.session_id, r.model, ${CONTEXT} AS used, MAX(${CONTEXT}) OVER (PARTITION BY r.session_id) AS max_used,
            ROW_NUMBER() OVER (PARTITION BY r.session_id ORDER BY r.ts DESC, r.message_id DESC) AS rn
          FROM requests r JOIN recent ON recent.id = r.session_id WHERE r.agent_id IS NULL
        ), cost AS (
          SELECT r.session_id, COALESCE(SUM(r.cost_usd), 0) AS cost_usd FROM requests r JOIN recent ON recent.id = r.session_id
          GROUP BY r.session_id
        )
      SELECT recent.id, recent.title, recent.project_cwd, recent.last_ts, main.model, main.used AS context_used,
        main.max_used AS max_context, cost.cost_usd
      FROM recent JOIN main ON main.session_id = recent.id AND main.rn = 1 JOIN cost ON cost.session_id = recent.id
      ORDER BY recent.last_ts DESC`,
    )
    .all({ cutoff, limit });
}
