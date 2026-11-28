import type { AgentNode, Usage } from "../../server/dashboard.types.ts";
import type { ClientTableOptions } from "@/lib/table.client.ts";
import { NO_GROUP, type TableSpec } from "@/lib/table.query.ts";

/** Rows per page of the session Agents table. */
export const SESSION_AGENTS_SIZE = 25;
/** Role shown for a run whose transcript names no agent type. */
export const UNTYPED_ROLE = "subagent";

/** URL state of the session Agents table: start order, Role facet only (runs mix several models, so a model facet would mislead). */
export const SESSION_AGENTS_SPEC: TableSpec = {
  sorts: ["start", "requests", "tokens", "cost"],
  defaultSort: "start",
  defaultDir: "asc",
  groups: [NO_GROUP],
  facets: { role: "free" },
};

export const roleOf = (a: AgentNode): string => a.agent_type ?? UNTYPED_ROLE;
export const tokensOf = (u: Pick<Usage, "input" | "output" | "cache_read" | "cache_write">): number => u.input + u.output + u.cache_read + u.cache_write;

/** Search, facet and sort accessors; search covers role, description and models. */
export const sessionAgentOptions: ClientTableOptions<AgentNode> = {
  text: (a) => [roleOf(a), a.description ?? "", ...a.models].join(" "),
  facets: { role: roleOf },
  sort: { start: (a) => a.first_ts ?? "", requests: (a) => a.requests, tokens: tokensOf, cost: (a) => a.cost_usd },
};

/** One role's share of the subagent runs. */
export interface RoleSummary { role: string; runs: number; requests: number; cost_usd: number; unpriced: number }

/** Subagent runs grouped by role, most expensive first (ties by role name). */
export function byRole(agents: readonly AgentNode[]): RoleSummary[] {
  const m = new Map<string, RoleSummary>();
  for (const a of agents) {
    const r = m.get(roleOf(a)) ?? { role: roleOf(a), runs: 0, requests: 0, cost_usd: 0, unpriced: 0 };
    r.runs += 1;
    r.requests += a.requests;
    r.cost_usd += a.cost_usd;
    r.unpriced += a.unpriced;
    m.set(r.role, r);
  }
  return [...m.values()].sort((a, b) => b.cost_usd - a.cost_usd || a.role.localeCompare(b.role));
}
