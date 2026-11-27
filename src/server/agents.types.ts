import type { Tier } from "../config/config.store.ts";

export type AgentKind = "preset" | "custom" | "external";
export type ExternalSource = "file" | "builtin" | "plugin" | "unknown";
export interface AgentScope { scope: "user" | "project"; path: string; state: "installed" | "edited" | "missing" | "shadowed" }
export interface AgentUsage { requests: number; cost_usd: number; unpriced: number; last_ts: string | null; rerouted_pct: number | null }
export interface AgentRow {
  name: string; kind: AgentKind; source: ExternalSource | null; status: "enabled" | "disabled";
  description: string | null; color: string | null;
  tier: Tier | null;            // null for externals
  pin: string | null;           // config.roleModels value when it's a model, else null
  alias: string | null;         // opus|sonnet|haiku, or the pin, or the external file's model
  model_id: string | null;      // config.tiers[tier] when tier-routed; the pin when it's a full ID
  tools: string[] | null;       // null = inherit all
  disallowed_tools: string[] | null;
  scopes: AgentScope[]; main_agent: boolean; usage: AgentUsage;
}
export interface AgentsResponse { items: AgentRow[]; truncated: boolean; etag: string; tiers: Record<Tier, string>; known_tools: string[]; warnings: string[]; installed: boolean }
export interface AgentDetail extends AgentRow { prompt: string | null; prompt_source: "config" | "file" | "default" | null; file_path: string | null; warnings: string[]; etag: string }
export type ModelChoice = { tier: Tier } | { pin: string } | { default: true }; // default: presets only
export interface AgentInput { name: string; description: string; model: { tier: Tier } | { pin: string }; tools: string[] | null; prompt?: string }
export type AgentPatch = Partial<Omit<AgentInput, "name" | "model">> & { model?: ModelChoice; enabled?: boolean };
export interface AgentWriteResult { agent: AgentDetail; applied: number /* installs re-applied */; etag: string }
export interface SessionInfo { write: boolean; token: string | null }
