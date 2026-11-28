import type { RoleRow, Usage } from "../../server/dashboard.types.ts";
import type { RoleMeta } from "./color.tokens.ts";
import { tierOf, type Tier, type TierKey, type Tiers } from "./model.tier.ts";
import { cacheHitRate, fmtPct } from "./format.ts";

/** Where a role comes from: shipped preset, made with `roles add`, or external (Claude Code built-in, plugin or ~/.claude/agents). */
export type RoleKind = "preset" | "custom" | "external";
/** Kinds in display order. */
export const ROLE_KINDS: readonly RoleKind[] = ["preset", "custom", "external"];
/** A role × model row with the tier its model was billed under. */
export interface TieredRow extends RoleRow { tier: TierKey }

const USAGE_KEYS = ["requests", "input", "output", "cache_read", "cache_write", "cost_usd", "unpriced"] as const;

/** Adds up the usage fields of any rows. */
export function sumUsage(rows: readonly Usage[]): Usage {
  const out: Usage = { requests: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, unpriced: 0 };
  for (const r of rows) for (const k of USAGE_KEYS) out[k] += r[k];
  return out;
}

/** Rerouted requests summed over any role rows. */
export const sumRerouted = (rows: readonly { rerouted: number }[]): number => rows.reduce((n, r) => n + r.rerouted, 0);

/** Stamps each row with `tierOf(model, tiers)` so tier totals match Overview "Cost by tier". */
export const withTier = (rows: readonly RoleRow[], tiers?: Partial<Tiers>): TieredRow[] =>
  rows.map((r) => ({ ...r, tier: tierOf(r.model, tiers) }));

/** Kind of a role, from the `meta.roles` roster only (never the name): anything not in the roster is external. */
export function roleKind(role: string, roles?: readonly RoleMeta[]): RoleKind {
  return roles?.find((r) => r.name === role)?.source ?? "external";
}

/** Cache-hit subtotal of grouped rows, token-weighted (sums the parts before dividing); "—" with no requests. */
export function cacheHitLabel(u: Usage): string {
  return u.requests ? fmtPct(cacheHitRate(u)) : "—";
}

/** The role's configured tier when it differs from the tier this row was billed under; undefined when equal or unknown. */
export function configuredTierMismatch(role: string, rowTier: TierKey, roles?: readonly RoleMeta[]): Tier | undefined {
  const configured = roles?.find((r) => r.name === role)?.tier;
  return configured && configured !== rowTier ? configured : undefined;
}
