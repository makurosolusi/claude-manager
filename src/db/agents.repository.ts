import type { Database } from "bun:sqlite";
import { FROM, KEY, REROUTED_COUNT, type Params } from "./stats.repository.ts";

/** Usage of one named role (agent) over a window. */
export interface AgentUsageRow {
  role: string;
  requests: number;
  cost_usd: number;
  /** Requests whose model has no known rates (excluded from cost_usd). */
  unpriced: number;
  last_ts: string;
  rerouted: number;
}

// Role keys that are not a named agent: plain main session and subagent without a type. Dropped in SQL so callers never see them.
const UNNAMED_ROLES = "('main', 'subagent')";

/** Per-role request count, cost, last use and rerouted count since `since` (ISO), one grouped query; `main`/`subagent` are excluded. */
export function agentUsage(db: Database, since: string): AgentUsageRow[] {
  return db
    .query<AgentUsageRow, Params>(
      `SELECT ${KEY.role} AS role, COUNT(*) AS requests, COALESCE(SUM(r.cost_usd), 0) AS cost_usd,
        SUM(r.cost_usd IS NULL) AS unpriced, MAX(r.ts) AS last_ts, ${REROUTED_COUNT}
      ${FROM} WHERE r.ts >= $since GROUP BY role HAVING role NOT IN ${UNNAMED_ROLES} ORDER BY role`,
    )
    .all({ since });
}
