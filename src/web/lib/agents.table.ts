import type { AgentRow } from "../../server/agents.types.ts";
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

/** URL spec of the Agents table: name order, grouped by kind by default. */
export const AGENTS_SPEC: TableSpec = {
  sorts: ["name", "requests", "cost", "last"],
  defaultSort: "name",
  defaultDir: "asc",
  groups: ["kind", "tier", "scope", NO_GROUP],
  facets: { kind: KINDS, tier: TIERS, scope: SCOPES, status: STATUSES },
};

/** Default group of the Agents table. */
export const AGENTS_DEFAULT_GROUP = "kind";

/** Tier facet value: "pinned" wins over the tier, externals fall to "none". */
export const tierKey = (r: Pick<AgentRow, "tier" | "pin">): string => (r.pin ? TIER_PINNED : r.tier ?? TIER_NONE);

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

const GROUP_KEY: Record<string, (r: AgentRow) => string> = { kind: (r) => r.kind, tier: tierKey, scope: scopeKey };

/** Group key of a row for the `group` URL value (NO_GROUP and unknown values yield one "all" bucket). */
export const agentGroupKey = (group: string, r: AgentRow): string => GROUP_KEY[group]?.(r) ?? "all";

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
