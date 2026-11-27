import type { UsageRow } from "../db/stats.repository.ts";
export type { UsageRow };
export type Usage = Omit<UsageRow, "key">;
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export interface Overview { since: string; total: Usage; byDay: UsageRow[]; byModel: UsageRow[]; byRole: UsageRow[] }
export interface ProjectRow extends Usage { project: string; sessions: number; last_ts: string | null }
export interface SessionRow extends Usage { id: string; title: string | null; project_cwd: string | null; git_branch: string | null; main_agent: string | null; first_ts: string | null; last_ts: string | null; agents: number }
export interface AgentNode extends Usage { id: string; parent_agent_id: string | null; agent_type: string | null; description: string | null; spawn_depth: number | null; first_ts: string | null; models: string[] }
export interface SessionDetail { session: SessionRow; agents: AgentNode[] }
export interface TimelineItem extends Usage { uuid: string; ts: string; source: string | null; text: string | null; agent_id: string | null; models: string[] }
export interface RoleRow extends Usage { role: string; model: string }
export interface LiveSession { id: string; title: string | null; project_cwd: string | null; model: string; last_ts: string; context_used: number; context_window: number; context_left_pct: number; cost_usd: number }
export interface ApiError { error: string }
