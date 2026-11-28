import type { AgentRow } from "../../server/agents.types.ts";
import { TIER_ALIAS_MAP } from "../../roles/model.ids.ts";
import { BUILTIN_AGENT_INFO } from "../../roles/roles.builtins.ts";
import type { Tier } from "./model.tier.ts";

export interface Hierarchy {
  mains: AgentRow[];
  tiers: Record<Tier, AgentRow[]>;
  pinned: AgentRow[];
  unmanaged: AgentRow[];
}

export interface AffectedItem { kind: "agent" | "builtin" | "external" | "text"; label: string }

export const TIER_LIST: readonly Tier[] = ["think", "work", "basic"];
/** Tier → model alias (shared with config.store via roles/model.ids). */
export const TIER_ALIAS: Record<Tier, "opus" | "sonnet" | "haiku"> = TIER_ALIAS_MAP;

const BACKGROUND_TEXT = "Claude Code background tasks (haiku alias)";

/**
 * Tier an alias pin (`opus`, `sonnet`, `haiku`) still routes through, or null for a full-id pin or `fable`
 * (an alias with no tier: nothing a tier edit can change, so it stays in the Pinned lane).
 */
export const pinTier = (pin: string | null): Tier | null => TIER_LIST.find((t) => TIER_ALIAS[t] === pin) ?? null;

/** Lane an agent belongs to: its alias pin's tier, else its own tier when unpinned, else null (full-id pin or no tier). */
const laneTier = (a: AgentRow): Tier | null => (a.pin ? pinTier(a.pin) : a.tier);

const managed = (a: AgentRow) => a.kind !== "external";

/** Splits agents into the main agent(s), per-tier lanes, pinned and unmanaged (external); disabled agents keep their lane. */
export function buildHierarchy(items: AgentRow[]): Hierarchy {
  const tiers: Record<Tier, AgentRow[]> = { think: [], work: [], basic: [] };
  const h: Hierarchy = { mains: [], tiers, pinned: [], unmanaged: [] };
  for (const a of items) {
    if (!managed(a)) h.unmanaged.push(a);
    else {
      if (a.main_agent) h.mains.push(a);
      const t = laneTier(a);
      if (t) tiers[t].push(a);
      else if (a.pin) h.pinned.push(a);
    }
  }
  return h;
}

/** What a change to `tier`'s model re-routes: tier-routed agents, built-ins and externals on the same alias, plus session-level uses. */
export function affectedBy(tier: Tier, items: AgentRow[]): AffectedItem[] {
  const alias = TIER_ALIAS[tier];
  const out: AffectedItem[] = [];
  for (const a of items) {
    if (managed(a) && a.status === "enabled" && laneTier(a) === tier) out.push({ kind: "agent", label: a.name });
  }
  for (const [name, info] of Object.entries(BUILTIN_AGENT_INFO)) if (info.model === alias) out.push({ kind: "builtin", label: name });
  for (const a of items) {
    if (!managed(a) && a.alias === alias && !Object.hasOwn(BUILTIN_AGENT_INFO, a.name)) out.push({ kind: "external", label: a.name });
  }
  if (tier === "basic") out.push({ kind: "text", label: BACKGROUND_TEXT });
  out.push({ kind: "text", label: `Any session started with /model ${alias} or --model ${alias}` });
  return out;
}
