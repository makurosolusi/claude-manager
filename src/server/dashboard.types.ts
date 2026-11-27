import type { Tier } from "../config/config.store.ts";
import type { DayModelRow, Totals, UsageRow } from "../db/stats.repository.ts";
export type { DayModelRow, Totals, UsageRow };
export type Usage = Omit<UsageRow, "key">;
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
/** `prev` covers the same-length window right before `since`; null for all-time. */
export interface Overview { since: string; total: Totals; prev: Totals | null; byDay: UsageRow[]; byDayModel: DayModelRow[]; byModel: UsageRow[]; byRole: UsageRow[] }
export interface ProjectRow extends Usage { project: string; sessions: number; last_ts: string | null }
/** `model` = most-used main-agent model (else most-used overall); `models` = distinct models used. */
export interface SessionRow extends Usage { id: string; title: string | null; project_cwd: string | null; git_branch: string | null; main_agent: string | null; first_ts: string | null; last_ts: string | null; agents: number; model: string | null; models: number }
/** Sort keys accepted by /api/sessions?sort=. */
export const SESSION_SORTS = ["last", "cost", "requests", "tokens", "agents"] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];
export interface SessionQuery { sort: SessionSort; dir: "asc" | "desc"; q?: string }
/** Model families as the SQL helper and the web bundle name them. */
export const FAMILIES = ["opus", "sonnet", "haiku", "other"] as const;
export const SESSION_STATUSES = ["live", "idle", "ended"] as const;
/** Minutes since `last_ts` up to which a session is live / idle; older = ended. */
export const SESSION_STATUS_MIN = { live: 5, idle: 15 } as const;
export const SESSION_GROUPS = ["project", "family", "status"] as const;
export const REQUEST_GROUPS = ["agent", "family", "stop"] as const;
/** Upper bound of rows a groups endpoint returns. */
export const MAX_GROUPS = 100;
export type SessionGroupBy = (typeof SESSION_GROUPS)[number];
export interface FacetCount { value: string; count: number }
export interface SessionFacets { project: FacetCount[]; family: FacetCount[]; role: FacetCount[]; status: FacetCount[] }
export type SessionsResponse = Page<SessionRow> & { facets?: SessionFacets };
export interface GroupRow extends Usage { key: string; count: number; last_ts: string | null }
export interface SessionGroups { by: SessionGroupBy; groups: GroupRow[]; total_groups: number }
export interface AgentNode extends Usage { id: string; parent_agent_id: string | null; agent_type: string | null; description: string | null; spawn_depth: number | null; first_ts: string | null; models: string[] }
export interface SessionDetail { session: SessionRow; agents: AgentNode[] }
export interface TimelineItem extends Usage { uuid: string; ts: string; source: string | null; text: string | null; agent_id: string | null; models: string[] }
export interface RoleRow extends Usage { role: string; model: string }
export interface LiveSession { id: string; title: string | null; project_cwd: string | null; model: string; last_ts: string; context_used: number; context_window: number; context_left_pct: number; cost_usd: number }
/** Background sync state of the running dashboard. */
export interface SyncMeta { synced_at: string | null; changed_at: string | null; error: string | null; interval_ms: number }
/** /api/meta body: sync state, configured model ID per tier, and the role roster. */
export type DashboardMeta = SyncMeta & { tiers: Record<Tier, string>; roles: MetaRole[] };
/** A resolved role: preset vs custom decides how the web renders its badge. */
export interface MetaRole { name: string; tier: Tier; source: "preset" | "custom" }
export interface ApiError { error: string }
