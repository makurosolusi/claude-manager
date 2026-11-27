import type { FAMILIES, FacetCount, GroupRow, REQUEST_GROUPS } from "./dashboard.types.ts";
import type { AgentNode, Page, SessionRow, Usage, UsageRow } from "./dashboard.types.ts";

export type Family = (typeof FAMILIES)[number];
export type RequestGroupBy = (typeof REQUEST_GROUPS)[number];

/** Sort keys accepted by /api/sessions/:id/requests?sort=. */
export const REQUEST_SORTS = ["ts", "cost", "tokens", "context"] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];
/** Stop-reason filter value that matches requests whose stop_reason is NULL. */
export const STOP_NONE = "none";

/** One model request of a session; `context` = input + cache_read + cache_5m + cache_1h. */
export interface RequestRow extends Omit<Usage, "requests" | "unpriced"> {
  message_id: string;
  ts: string;
  model: string;
  agent_id: string | null;
  role: string;
  stop_reason: string | null;
  tools: string[];
  context: number;
}

/** Repeatable filters (an undefined list means "no filter on that dimension") plus the free-text `q` search. */
export interface RequestFilter { family?: string[]; agent?: string[]; stop?: string[]; tool?: string[]; q?: string }
export type RequestDimension = Exclude<keyof RequestFilter, "q">;
export interface RequestQuery { sort: RequestSort; dir: "asc" | "desc" }
export interface RequestFacets { family: FacetCount[]; agent: FacetCount[]; stop: FacetCount[]; tool: FacetCount[] }
export type RequestsResponse = Page<RequestRow> & { facets?: RequestFacets };
export interface RequestGroups { by: RequestGroupBy; groups: GroupRow[]; total_groups: number }
export interface ToolCount { name: string; calls: number }
/** Last main-agent request's context size, before the window is inferred. */
export interface ContextSample { model: string; used: number; max_used: number }

/** /api/sessions/:id body: the base detail plus per-model, per-tool and context summaries. */
export interface SessionDetailFull {
  session: SessionRow;
  agents: AgentNode[];
  models: UsageRow[];
  tools: ToolCount[];
  compactions: number;
  context: { used: number; window: number } | null;
}
