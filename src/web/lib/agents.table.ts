import { BUILTIN_AGENT_INFO } from "../../roles/roles.builtins.ts";
import type { AgentRow } from "../../server/agents.types.ts";
import { pinTier, TIER_ALIAS } from "@/lib/agents.hierarchy.ts";
import type { ClientTableOptions } from "@/lib/table.client.ts";
import { NO_GROUP, type TableSpec } from "@/lib/table.query.ts";

/** Hash route of the Agents page. */
export const AGENTS_PATH = "/agents";
/** Facet value for agents pinned to an explicit model (they have no tier of their own). */
export const TIER_PINNED = "pinned";
/** Facet/group value for agents with neither a tier nor a pin (externals). */
export const TIER_NONE = "none";

const KINDS = ["preset", "custom", "external"] as const;
const TIERS = ["think", "work", "basic", TIER_PINNED, TIER_NONE] as const;
const SCOPES = ["user", "project", "both", "none"] as const;
const STATUSES = ["enabled", "disabled"] as const;

/** URL spec of the Agents table: name order, grouped by level (main agent, then tiers) by default. */
export const AGENTS_SPEC: TableSpec = {
  sorts: ["name", "requests", "cost", "last"],
  defaultSort: "name",
  defaultDir: "asc",
  groups: ["kind", "tier", "scope", NO_GROUP],
  facets: { kind: KINDS, tier: TIERS, scope: SCOPES, status: STATUSES },
};

/** Default group of the Agents table. */
export const AGENTS_DEFAULT_GROUP = "tier";

/** Tier facet value: an alias pin keeps its tier (same rule as the hierarchy panel); `fable` and full-id pins are "pinned"; externals fall to "none". */
export const tierKey = (r: Pick<AgentRow, "tier" | "pin">): string => (r.pin ? pinTier(r.pin) ?? TIER_PINNED : r.tier ?? TIER_NONE);

/** Scope facet value: which scopes the agent is installed in ("both" for user + project, "none" when not installed). */
export function scopeKey(r: Pick<AgentRow, "scopes">): string {
  const s = new Set(r.scopes.map((x) => x.scope));
  return s.size === 2 ? "both" : (s.values().next().value ?? "none");
}

/** Search, facet and sort accessors for agents; search covers name, description and tools. */
export const agentTableOptions: ClientTableOptions<AgentRow> = {
  text: (r) => [r.name, r.description ?? "", ...(r.tools ?? [])].join(" "),
  facets: { kind: (r) => r.kind, tier: tierKey, scope: scopeKey, status: (r) => r.status },
  sort: {
    name: (r) => r.name,
    requests: (r) => r.usage.requests,
    cost: (r) => r.usage.cost_usd,
    last: (r) => r.usage.last_ts ?? "",
  },
};

/** Group value for the managed main agent. */
export const LEVEL_MAIN = "main";
const LEVELS = [LEVEL_MAIN, ...TIERS] as const;

/** Level group key: a managed main agent leads, everyone else falls into their tier bucket. */
export const levelKey = (r: Pick<AgentRow, "main_agent" | "kind" | "tier" | "pin">): string => (r.main_agent && r.kind !== "external" ? LEVEL_MAIN : tierKey(r));

/** Group header text of a level key: `Think · opus → claude-opus-5-5` when the tier's model is known. */
export function levelLabel(key: string, tiers?: Partial<Record<keyof typeof TIER_ALIAS, string>>): string {
  if (key === LEVEL_MAIN) return "Main agent";
  if (key === TIER_PINNED) return "Pinned";
  if (key === TIER_NONE) return "Not managed";
  const t = key as keyof typeof TIER_ALIAS;
  const model = tiers?.[t];
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} · ${TIER_ALIAS[t]}${model ? ` → ${model}` : ""}`;
}

const GROUP_KEY: Record<string, (r: AgentRow) => string> = { kind: (r) => r.kind, tier: levelKey, scope: scopeKey };

/** Group key of a row for the `group` URL value (NO_GROUP and unknown values yield one "all" bucket). */
export const agentGroupKey = (group: string, r: AgentRow): string => GROUP_KEY[group]?.(r) ?? "all";

const GROUP_ORDER: Record<string, readonly string[]> = { kind: KINDS, tier: LEVELS, scope: SCOPES };

/** Stable reorder so groups appear in the declared order (Preset, Custom, External…) instead of first-row-seen; rows keep their sort inside a group. */
export function orderByGroup(rows: AgentRow[], group: string): AgentRow[] {
  const order = GROUP_ORDER[group];
  if (!order) return rows;
  const rank = (r: AgentRow) => { const i = order.indexOf(agentGroupKey(group, r)); return i < 0 ? order.length : i; };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

/** Pieces of the model chain, shared by `chainText` and the ModelChain component. */
export type ChainInput = Pick<AgentRow, "tier" | "pin" | "alias" | "model_id"> & { name?: string };

/** Ordered text segments of the chain: tier-routed `tier → alias → model`, pinned `pinned → alias`, else alias/model or "inherit". */
export function chainSegments(r: ChainInput): string[] {
  const model = r.model_id && r.model_id !== r.alias ? [r.model_id] : [];
  const lead = r.name ? [r.name] : [];
  if (r.pin) return [...lead, TIER_PINNED, r.alias ?? r.pin, ...model];
  if (r.tier) return [...lead, r.tier, ...(r.alias ? [r.alias] : []), ...model];
  const rest = [...(r.alias ? [r.alias] : []), ...model];
  return [...lead, ...(rest.length ? rest : ["inherit"])];
}

/** One-line chain for search, tooltips and aria-labels: "coder → work → sonnet → claude-sonnet-5-5". */
export const chainText = (r: ChainInput): string => chainSegments(r).join(" → ");

const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch", "TodoWrite"]);
const BUILTIN_TOOLS = { "read-only": "Read-only", all: "All tools" } as const;
const SHOWN_TOOLS = 2;

type ToolsInput = Pick<AgentRow, "name" | "source" | "tools" | "disallowed_tools">;

/** Short Tools cell text: built-ins from the catalog, "All tools", "Read-only · N", or the first two names + "+N". */
export function toolsLabel(r: ToolsInput): string {
  if (r.source === "builtin") {
    const t = BUILTIN_AGENT_INFO[r.name]?.tools;
    return t ? BUILTIN_TOOLS[t] : "—";
  }
  if (!r.tools) return r.disallowed_tools?.length ? `All except ${r.disallowed_tools.join(", ")}` : "All tools";
  if (!r.tools.length) return "None";
  if (r.tools.every((t) => READ_ONLY_TOOLS.has(t))) return `Read-only · ${r.tools.length}`;
  const extra = r.tools.length - SHOWN_TOOLS;
  return `${r.tools.slice(0, SHOWN_TOOLS).join(", ")}${extra > 0 ? ` +${extra}` : ""}`;
}

/** Full tool list for the cell's tooltip. */
export const toolsTitle = (r: ToolsInput): string => (r.tools ? r.tools.join(", ") || "None" : toolsLabel(r));
