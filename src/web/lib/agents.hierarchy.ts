import type { AgentRow } from "../../server/agents.types.ts";
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
/** Tier → model alias; mirrors `TIER_ALIAS` in config.store (not imported: that module pulls in node:fs). */
export const TIER_ALIAS: Record<Tier, "opus" | "sonnet" | "haiku"> = { think: "opus", work: "sonnet", basic: "haiku" };

const BACKGROUND_TEXT = "Claude Code background tasks (haiku alias)";

const managed = (a: AgentRow) => a.kind !== "external";

/** Splits agents into the main agent(s), per-tier lanes, pinned and unmanaged (external); disabled agents keep their lane. */
export function buildHierarchy(items: AgentRow[]): Hierarchy {
  const tiers: Record<Tier, AgentRow[]> = { think: [], work: [], basic: [] };
  const h: Hierarchy = { mains: [], tiers, pinned: [], unmanaged: [] };
  for (const a of items) {
    if (!managed(a)) h.unmanaged.push(a);
    else {
      if (a.main_agent) h.mains.push(a);
      if (a.pin) h.pinned.push(a);
      else if (a.tier) tiers[a.tier].push(a);
    }
  }
  return h;
}

/** What a change to `tier`'s model re-routes: tier-routed agents, built-ins and externals on the same alias, plus session-level uses. */
export function affectedBy(tier: Tier, items: AgentRow[]): AffectedItem[] {
  const alias = TIER_ALIAS[tier];
  const out: AffectedItem[] = [];
  for (const a of items) {
    if (managed(a) && a.status === "enabled" && a.tier === tier && !a.pin) out.push({ kind: "agent", label: a.name });
  }
  for (const [name, info] of Object.entries(BUILTIN_AGENT_INFO)) if (info.model === alias) out.push({ kind: "builtin", label: name });
  for (const a of items) {
    if (!managed(a) && a.alias === alias && !Object.hasOwn(BUILTIN_AGENT_INFO, a.name)) out.push({ kind: "external", label: a.name });
  }
  if (tier === "basic") out.push({ kind: "text", label: BACKGROUND_TEXT });
  out.push({ kind: "text", label: `Any session started with /model ${alias} or --model ${alias}` });
  return out;
}
