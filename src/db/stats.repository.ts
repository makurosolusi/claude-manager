import type { Database } from "bun:sqlite";

export const GROUP_BY = ["model", "role", "project", "day"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export interface StatsFilter {
  /** ISO timestamp lower bound (inclusive). */
  since: string;
  /** Substring of the session's project cwd. */
  project?: string;
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

// Role of a request: the subagent's type, else the session's main agent (`claude --agent X`), else plain main.
export const KEY: Record<GroupBy, string> = {
  model: "r.model",
  role: "CASE WHEN r.agent_id IS NOT NULL THEN COALESCE(a.agent_type, 'subagent') ELSE COALESCE(s.main_agent, 'main') END",
  project: "COALESCE(s.project_cwd, '(unknown)')",
  day: "substr(r.ts, 1, 10)",
};

/** Request filter for StatsFilter; expects `r` = requests, `s` = sessions. */
export const WHERE = "r.ts >= $since AND ($project IS NULL OR instr(s.project_cwd, $project) > 0)";

/** Token and cost totals grouped by one dimension, most expensive first (days: newest first). */
export function usageBy(db: Database, by: GroupBy, f: StatsFilter, limit: number): UsageRow[] {
  const order = by === "day" ? "key DESC" : "cost_usd DESC, requests DESC";
  return db
    .query<UsageRow, Record<string, string | number | null>>(
      `SELECT ${KEY[by]} AS key, COUNT(*) AS requests, SUM(r.input) AS input, SUM(r.cache_5m + r.cache_1h) AS cache_write,
        SUM(r.cache_read) AS cache_read, SUM(r.output) AS output, COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
        SUM(r.cost_usd IS NULL) AS unpriced
      FROM requests r LEFT JOIN agents a ON a.id = r.agent_id LEFT JOIN sessions s ON s.id = r.session_id
      WHERE ${WHERE} GROUP BY key ORDER BY ${order} LIMIT $limit`,
    )
    .all({ since: f.since, project: f.project ?? null, limit });
}

export function usageTotal(db: Database, f: StatsFilter): Omit<UsageRow, "key"> {
  return db
    .query<Omit<UsageRow, "key">, Record<string, string | null>>(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_5m + r.cache_1h), 0) AS cache_write,
        COALESCE(SUM(r.cache_read), 0) AS cache_read, COALESCE(SUM(r.output), 0) AS output, COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
        COALESCE(SUM(r.cost_usd IS NULL), 0) AS unpriced
      FROM requests r LEFT JOIN sessions s ON s.id = r.session_id WHERE ${WHERE}`,
    )
    .get({ since: f.since, project: f.project ?? null })!;
}
