import type { Database } from "bun:sqlite";

export const GROUP_BY = ["model", "role", "project", "day"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export interface StatsFilter {
  /** ISO timestamp lower bound (inclusive). */
  since: string;
  /** ISO timestamp upper bound (exclusive); open-ended when absent. */
  until?: string;
  /** Substring of the session's project cwd. */
  project?: string;
  /** Exact project cwd values (dashboard); ANDed with `project`. */
  projects?: string[];
}

export interface UsageRow {
  key: string;
  requests: number;
  input: number;
  cache_write: number;
  cache_read: number;
  output: number;
  cost_usd: number;
  /** Requests whose model has no known rates (excluded from cost_usd). */
  unpriced: number;
}

/** Window totals plus the number of distinct sessions that made requests in it. */
export type Totals = Omit<UsageRow, "key"> & { sessions: number };

/** Estimated cost and request count for one model on one day. */
export interface DayModelRow {
  day: string;
  model: string;
  cost_usd: number;
  requests: number;
}

/** SQL named-parameter bag. */
export type Params = Record<string, string | number | null>;

// Role of a request: the subagent's type, else the session's main agent (`claude --agent X`), else plain main.
export const KEY: Record<GroupBy, string> = {
  model: "r.model",
  role: "CASE WHEN r.agent_id IS NOT NULL THEN COALESCE(a.agent_type, 'subagent') ELSE COALESCE(s.main_agent, 'main') END",
  project: "COALESCE(s.project_cwd, '(unknown)')",
  day: "substr(r.ts, 1, 10)",
};

/** Request filter for StatsFilter; expects `r` = requests, `s` = sessions. Bind with `filterParams`. */
export const WHERE = `r.ts >= $since AND ($until IS NULL OR r.ts < $until) AND ($project IS NULL OR instr(s.project_cwd, $project) > 0)
  AND ($projects IS NULL OR s.project_cwd IN (SELECT value FROM json_each($projects)))`;

/** Binds a string list for `json_each($x)`; null = no filter. */
export const listParam = (v?: readonly string[]): string | null => (v?.length ? JSON.stringify(v) : null);

/** Model family of a SQL model-id expression; mirrors `modelFamily()` in the web bundle. */
export const FAMILY_SQL = (col: string) =>
  `CASE WHEN instr(lower(${col}), 'opus') > 0 THEN 'opus' WHEN instr(lower(${col}), 'sonnet') > 0 THEN 'sonnet' WHEN instr(lower(${col}), 'haiku') > 0 THEN 'haiku' WHEN instr(lower(${col}), 'fable') > 0 THEN 'fable' ELSE 'other' END`;

/** SQL bindings for `WHERE`. */
export const filterParams = (f: StatsFilter): Params => ({
  since: f.since,
  until: f.until ?? null,
  project: f.project ?? null,
  projects: listParam(f.projects),
});

const FROM = "FROM requests r LEFT JOIN agents a ON a.id = r.agent_id LEFT JOIN sessions s ON s.id = r.session_id";

/** Token and cost totals grouped by one dimension, most expensive first (days: newest first). */
export function usageBy(db: Database, by: GroupBy, f: StatsFilter, limit: number): UsageRow[] {
  const order = by === "day" ? "key DESC" : "cost_usd DESC, requests DESC";
  return db
    .query<UsageRow, Params>(
      `SELECT ${KEY[by]} AS key, COUNT(*) AS requests, SUM(r.input) AS input, SUM(r.cache_5m + r.cache_1h) AS cache_write,
        SUM(r.cache_read) AS cache_read, SUM(r.output) AS output, COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
        SUM(r.cost_usd IS NULL) AS unpriced
      ${FROM} WHERE ${WHERE} GROUP BY key ORDER BY ${order} LIMIT $limit`,
    )
    .all({ ...filterParams(f), limit });
}

/** Whole-window totals including the distinct session count. */
export function totals(db: Database, f: StatsFilter): Totals {
  return db
    .query<Totals, Params>(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_5m + r.cache_1h), 0) AS cache_write,
        COALESCE(SUM(r.cache_read), 0) AS cache_read, COALESCE(SUM(r.output), 0) AS output, COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
        COALESCE(SUM(r.cost_usd IS NULL), 0) AS unpriced, COUNT(DISTINCT r.session_id) AS sessions
      FROM requests r LEFT JOIN sessions s ON s.id = r.session_id WHERE ${WHERE}`,
    )
    .get(filterParams(f))!;
}

/** Whole-window totals in the shape `stats` prints (no session count, so its output stays unchanged). */
export function usageTotal(db: Database, f: StatsFilter): Omit<UsageRow, "key"> {
  const { sessions: _, ...usage } = totals(db, f);
  return usage;
}

/** Cost per (day, model) for the newest `limitDays` days that have data; same days as `usageBy(db, "day", f, limitDays)`. */
export function costByDayModel(db: Database, f: StatsFilter, limitDays: number): DayModelRow[] {
  return db
    .query<DayModelRow, Params>(
      `WITH days AS (SELECT DISTINCT ${KEY.day} AS day ${FROM} WHERE ${WHERE} ORDER BY day DESC LIMIT $limit)
      SELECT ${KEY.day} AS day, r.model AS model, COALESCE(SUM(r.cost_usd), 0) AS cost_usd, COUNT(*) AS requests
      ${FROM} WHERE ${WHERE} AND ${KEY.day} >= (SELECT MIN(day) FROM days)
      GROUP BY day, model ORDER BY day DESC, cost_usd DESC, model`,
    )
    .all({ ...filterParams(f), limit: limitDays });
}
