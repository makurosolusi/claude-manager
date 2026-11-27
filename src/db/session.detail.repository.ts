import type { Database } from "bun:sqlite";
import type { FacetCount, GroupRow, UsageRow } from "../server/dashboard.types.ts";
import type {
  ContextSample, RequestDimension, RequestFacets, RequestFilter, RequestGroupBy, RequestQuery, RequestRow,
  RequestSort, ToolCount,
} from "../server/session.detail.types.ts";
import type { PageQuery } from "./dashboard.repository.ts";
import { FAMILY_SQL, KEY, REROUTED_SQL } from "./stats.repository.ts";

type Params = Record<string, string | number | null>;

/** Max rows per facet or group list. */
export const LIST_LIMIT = 50;

const CONTEXT = "r.input + r.cache_read + r.cache_5m + r.cache_1h";
const FROM = "FROM requests r LEFT JOIN agents a ON a.id = r.agent_id LEFT JOIN sessions s ON s.id = r.session_id";
const USAGE = `COUNT(*) AS requests, SUM(r.input) AS input, SUM(r.cache_5m + r.cache_1h) AS cache_write, SUM(r.cache_read) AS cache_read,
  SUM(r.output) AS output, COALESCE(SUM(r.cost_usd), 0) AS cost_usd, SUM(r.cost_usd IS NULL) AS unpriced`;

// Value expression of each filter/group dimension; `stop` maps NULL to the filterable literal "none".
const DIM_SQL: Record<RequestDimension, string> = {
  family: FAMILY_SQL("r.model"),
  agent: KEY.role,
  stop: "COALESCE(r.stop_reason, 'none')",
  tool: "",
  rerouted: `CASE WHEN ${REROUTED_SQL} THEN 'yes' ELSE 'no' END`,
};
// Filters bind as JSON arrays; NULL = no filter. `tool` uses EXISTS so a multi-tool request is still one row.
const DIM_WHERE: Record<RequestDimension, string> = {
  family: `($family IS NULL OR ${DIM_SQL.family} IN (SELECT value FROM json_each($family)))`,
  agent: `($agent IS NULL OR ${DIM_SQL.agent} IN (SELECT value FROM json_each($agent)))`,
  stop: `($stop IS NULL OR ${DIM_SQL.stop} IN (SELECT value FROM json_each($stop)))`,
  rerouted: `($rerouted IS NULL OR ${DIM_SQL.rerouted} IN (SELECT value FROM json_each($rerouted)))`,
  tool: `($tool IS NULL OR EXISTS (SELECT 1 FROM tool_calls tc WHERE tc.message_id = r.message_id
    AND tc.name IN (SELECT value FROM json_each($tool))))`,
};
// Free-text search: case-insensitive substring over model, agent/role key, stop reason or any tool name of the request.
const Q_WHERE = `($q IS NULL OR instr(lower(r.model), lower($q)) > 0 OR instr(lower(${DIM_SQL.agent}), lower($q)) > 0
  OR instr(lower(COALESCE(r.stop_reason, '')), lower($q)) > 0
  OR EXISTS (SELECT 1 FROM tool_calls tq WHERE tq.message_id = r.message_id AND instr(lower(tq.name), lower($q)) > 0))`;
const DIMENSIONS = Object.keys(DIM_WHERE) as RequestDimension[];
const GROUP_SQL: Record<RequestGroupBy, string> = { agent: DIM_SQL.agent, family: DIM_SQL.family, stop: DIM_SQL.stop };
// Unqualified names resolve to the page subquery's output columns, so one map serves inner and outer ORDER BY.
const SORT_SQL: Record<RequestSort, string> = { ts: "ts", cost: "cost_usd", tokens: "input + output + cache_read + cache_write", context: "context" };

/** WHERE for one session's requests with every filter except `exclude` (faceting skips a dimension's own filter). */
const where = (exclude?: RequestDimension) =>
  ["r.session_id = $id", Q_WHERE, ...DIMENSIONS.filter((d) => d !== exclude).map((d) => DIM_WHERE[d])].join(" AND ");

const listParam = (v: string[] | undefined) => (v?.length ? JSON.stringify(v) : null);
const bindings = (id: string, f: RequestFilter, exclude?: RequestDimension): Params => ({
  id,
  q: f.q || null,
  ...Object.fromEntries(DIMENSIONS.filter((d) => d !== exclude).map((d) => [d, listParam(f[d])])),
});

type RequestDbRow = Omit<RequestRow, "tools" | "rerouted"> & { tools: string | null; rerouted: number };

/** One page of a session's requests; tool names come from one join over the page rows only. */
export function requestsPage(db: Database, id: string, f: RequestFilter, q: RequestQuery, p: PageQuery): { items: RequestRow[]; total: number } {
  const params = bindings(id, f);
  const order = `${SORT_SQL[q.sort]} ${q.dir}, message_id`;
  const rows = db
    .query<RequestDbRow, Params>(
      `SELECT pg.*, group_concat(DISTINCT tc.name) AS tools
      FROM (SELECT r.message_id, r.ts, r.model, r.requested_model, ${REROUTED_SQL} AS rerouted, r.agent_id, ${DIM_SQL.agent} AS role, r.stop_reason, r.input,
          r.cache_5m + r.cache_1h AS cache_write, r.cache_read, r.output, COALESCE(r.cost_usd, 0) AS cost_usd, ${CONTEXT} AS context
        ${FROM} WHERE ${where()} ORDER BY ${order} LIMIT $limit OFFSET $offset) pg
      LEFT JOIN tool_calls tc ON tc.message_id = pg.message_id GROUP BY pg.message_id ORDER BY ${order}`,
    )
    .all({ ...params, limit: p.pageSize, offset: (p.page - 1) * p.pageSize });
  const total = db.query<{ n: number }, Params>(`SELECT COUNT(*) AS n ${FROM} WHERE ${where()}`).get(params)!.n;
  return { items: rows.map((r) => ({ ...r, rerouted: r.rerouted === 1, tools: r.tools ? r.tools.split(",") : [] })), total };
}

/** Per-dimension counts; each ignores its own filter so options stay selectable. */
export function requestFacets(db: Database, id: string, f: RequestFilter): RequestFacets {
  const count = (dim: RequestDimension): FacetCount[] => {
    const sql =
      dim === "tool"
        ? `SELECT tc.name AS value, COUNT(DISTINCT r.message_id) AS count ${FROM} JOIN tool_calls tc ON tc.message_id = r.message_id`
        : `SELECT ${DIM_SQL[dim]} AS value, COUNT(*) AS count ${FROM}`;
    return db
      .query<FacetCount, Params>(`${sql} WHERE ${where(dim)} GROUP BY value ORDER BY count DESC, value LIMIT $limit`)
      .all({ ...bindings(id, f, dim), limit: LIST_LIMIT });
  };
  return { family: count("family"), agent: count("agent"), stop: count("stop"), tool: count("tool"), rerouted: count("rerouted") };
}

/** Usage per group over every matching request (not one page), most expensive first. */
export function requestGroups(db: Database, id: string, by: RequestGroupBy, f: RequestFilter): { groups: GroupRow[]; total_groups: number } {
  const params = bindings(id, f);
  const groups = db
    .query<GroupRow, Params>(
      `SELECT ${GROUP_SQL[by]} AS key, COUNT(*) AS count, MAX(r.ts) AS last_ts, ${USAGE}
      ${FROM} WHERE ${where()} GROUP BY key ORDER BY cost_usd DESC, count DESC, key LIMIT $limit`,
    )
    .all({ ...params, limit: LIST_LIMIT });
  const total_groups = db.query<{ n: number }, Params>(`SELECT COUNT(DISTINCT ${GROUP_SQL[by]}) AS n ${FROM} WHERE ${where()}`).get(params)!.n;
  return { groups, total_groups };
}

/** Whole-session usage per model, most expensive first. */
export function sessionModels(db: Database, id: string): UsageRow[] {
  return db
    .query<UsageRow, Params>(`SELECT r.model AS key, ${USAGE} ${FROM} WHERE r.session_id = $id GROUP BY r.model ORDER BY cost_usd DESC, requests DESC, key`)
    .all({ id });
}

/** Tool call counts of a session, most called first. */
export function sessionTools(db: Database, id: string): ToolCount[] {
  return db
    .query<ToolCount, Params>("SELECT name, COUNT(*) AS calls FROM tool_calls WHERE session_id = $id GROUP BY name ORDER BY calls DESC, name LIMIT $limit")
    .all({ id, limit: LIST_LIMIT });
}

/** Number of context compactions recorded for a session. */
export function sessionCompactions(db: Database, id: string): number {
  return db.query<{ n: number }, Params>("SELECT COUNT(*) AS n FROM compactions WHERE session_id = $id").get({ id })!.n;
}

/** Latest main-agent request's context size and the session's peak, or undefined without main requests. */
export function latestContext(db: Database, id: string): ContextSample | undefined {
  return (
    db
      .query<ContextSample, Params>(
        `SELECT r.model, ${CONTEXT} AS used, MAX(${CONTEXT}) OVER () AS max_used FROM requests r
        WHERE r.session_id = $id AND r.agent_id IS NULL ORDER BY r.ts DESC, r.message_id DESC LIMIT 1`,
      )
      .get({ id }) ?? undefined
  );
}
