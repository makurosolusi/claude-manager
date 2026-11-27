import type { Database } from "bun:sqlite";
import { MAX_GROUPS, SESSION_STATUS_MIN, type FacetCount, type GroupRow, type SessionFacets, type SessionGroupBy, type SessionGroups, type SessionQuery, type SessionRow, type SessionSort, type Page } from "../server/dashboard.types.ts";
import { paged, primaryModel, SESSION_GROUPED, USAGE, withModel, type PageQuery } from "./dashboard.repository.ts";
import { FAMILY_SQL, KEY, listParam, type Params, type StatsFilter } from "./stats.repository.ts";

/** StatsFilter plus the sessions-only facets; `project` substring is ignored here, `projects` is exact. */
export interface SessionFilter extends StatsFilter {
  families?: string[];
  roles?: string[];
  statuses?: string[];
}

type Dim = "project" | "family" | "role" | "status";

const MINUTE_MS = 60_000;
const PROJECT_FACET_LIMIT = 50;
const IN = (param: string) => `IN (SELECT value FROM json_each(${param}))`;
const FAMILY = FAMILY_SQL(primaryModel("s.id"));
const STATUS = "CASE WHEN s.last_ts >= $liveCut THEN 'live' WHEN s.last_ts >= $idleCut THEN 'idle' ELSE 'ended' END";
const ROLE_EXISTS = `EXISTS (SELECT 1 FROM requests r LEFT JOIN agents a ON a.id = r.agent_id
  WHERE r.session_id = s.id AND ${KEY.role} ${IN("$roles")})`;

// ponytail: q and the primary-family filter scan the window's sessions/requests; materialise sessions.primary_model at ingest past ~1M requests.
const WHERE = `s.last_ts >= $since AND ($projects IS NULL OR s.project_cwd ${IN("$projects")})
  AND ($q IS NULL OR instr(lower(coalesce(s.title, '') || ' ' || s.id || ' ' || coalesce(s.project_cwd, '')), lower($q)) > 0)
  AND ($families IS NULL OR ${FAMILY} ${IN("$families")}) AND ($roles IS NULL OR ${ROLE_EXISTS})
  AND ($statuses IS NULL OR ${STATUS} ${IN("$statuses")})`;

const SORT_SQL: Record<SessionSort, string> = {
  last: "last_ts",
  cost: "cost_usd",
  requests: "requests",
  tokens: "input + output + cache_read + cache_write",
  agents: "agents",
};

const GROUP_KEY: Record<SessionGroupBy, string> = { project: "COALESCE(s.project_cwd, '(unknown)')", family: FAMILY, status: STATUS };

function bind(f: SessionFilter, q: string | undefined, now: number, skip?: Dim): Params {
  const off = (d: Dim) => d === skip;
  return {
    since: f.since,
    projects: off("project") ? null : listParam(f.projects),
    q: q ?? null,
    families: off("family") ? null : listParam(f.families),
    roles: off("role") ? null : listParam(f.roles),
    statuses: off("status") ? null : listParam(f.statuses),
    liveCut: new Date(now - SESSION_STATUS_MIN.live * MINUTE_MS).toISOString(),
    idleCut: new Date(now - SESSION_STATUS_MIN.idle * MINUTE_MS).toISOString(),
  };
}

/** Sessions matching the filters, sorted by `q.sort` (id breaks ties), with whole-session totals; `now` drives `status`. */
export function sessionsPage(db: Database, f: SessionFilter, p: PageQuery, q: SessionQuery = { sort: "last", dir: "desc" }, now = Date.now()): Page<SessionRow> {
  const order = `${SORT_SQL[q.sort]} ${q.dir}, id`;
  return paged<SessionRow>(
    db,
    p,
    withModel(`SELECT * FROM (${SESSION_GROUPED} WHERE ${WHERE} GROUP BY s.id) ORDER BY ${order} LIMIT $limit OFFSET $offset`, order),
    `SELECT COUNT(*) AS n FROM sessions s WHERE ${WHERE}`,
    bind(f, q.q, now),
  );
}

const facet = (db: Database, sql: string, params: Params) => db.query<FacetCount, Params>(sql).all(params);
const BY_COUNT = "ORDER BY count DESC, value";

/** Session counts per project/family/role/status; each dimension applies every filter except its own. */
export function sessionFacets(db: Database, f: SessionFilter, q: string | undefined, now = Date.now()): SessionFacets {
  const run = (dim: Dim, sql: string) => facet(db, sql, bind(f, q, now, dim));
  return {
    project: run("project", `SELECT s.project_cwd AS value, COUNT(*) AS count FROM sessions s WHERE ${WHERE} AND s.project_cwd IS NOT NULL GROUP BY value ${BY_COUNT} LIMIT ${PROJECT_FACET_LIMIT}`),
    family: run("family", `SELECT ${FAMILY} AS value, COUNT(*) AS count FROM sessions s WHERE ${WHERE} GROUP BY value ${BY_COUNT}`),
    role: run("role", `SELECT ${KEY.role} AS value, COUNT(DISTINCT s.id) AS count FROM sessions s JOIN requests r ON r.session_id = s.id LEFT JOIN agents a ON a.id = r.agent_id WHERE ${WHERE} GROUP BY value ${BY_COUNT}`),
    status: run("status", `SELECT ${STATUS} AS value, COUNT(*) AS count FROM sessions s WHERE ${WHERE} GROUP BY value ${BY_COUNT}`),
  };
}

/** Per-group session count and whole-session usage over every matching session (not one page), most expensive first. */
export function sessionGroups(db: Database, by: SessionGroupBy, f: SessionFilter, q: string | undefined, now = Date.now()): SessionGroups {
  const params = bind(f, q, now);
  const inner = `SELECT s.id, s.last_ts, ${GROUP_KEY[by]} AS key FROM sessions s WHERE ${WHERE}`;
  const groups = db
    .query<GroupRow, Params>(
      `SELECT g.key AS key, COUNT(DISTINCT g.id) AS count, MAX(g.last_ts) AS last_ts, ${USAGE}
      FROM (${inner}) g LEFT JOIN requests r ON r.session_id = g.id GROUP BY g.key ORDER BY cost_usd DESC, count DESC, key LIMIT $limit`,
    )
    .all({ ...params, limit: MAX_GROUPS });
  const total_groups = db.query<{ n: number }, Params>(`SELECT COUNT(DISTINCT key) AS n FROM (${inner})`).get(params)!.n;
  return { by, groups, total_groups };
}
