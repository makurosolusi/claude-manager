import type { RoleRow, Usage } from "../../server/dashboard.types.ts";
import type { RoleMeta } from "./color.tokens.ts";
import { TIER_ORDER, tierOf, type Tier, type TierKey, type Tiers } from "./model.tier.ts";
import { cacheHitRate, fmtPct } from "./format.ts";
import { groupBy } from "./table.client.ts";

/** Where a role comes from: shipped preset, made with `roles add`, or external (Claude Code built-in, plugin or ~/.claude/agents). */
export type RoleKind = "preset" | "custom" | "external";
/** Kinds in display order. */
export const ROLE_KINDS: readonly RoleKind[] = ["preset", "custom", "external"];
/** A role × model row with the tier its model was billed under. */
export interface TieredRow extends RoleRow { tier: TierKey }
/** Usage summed over one key (a model, a role or a tier), its tier, and its share of the overall cost (0..1). */
export interface AggRow extends Usage { key: string; tier: TierKey; count: number; share: number; rerouted: number }

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

/** Group keys ordered by TIER_ORDER (unknown keys last). */
export const byTierOrder = <T extends { key: string }>(gs: T[]): T[] =>
  [...gs].sort((a, b) => TIER_ORDER.indexOf(a.key as TierKey) - TIER_ORDER.indexOf(b.key as TierKey));

/** The role's configured tier when it differs from the tier this row was billed under; undefined when equal or unknown. */
export function configuredTierMismatch(role: string, rowTier: TierKey, roles?: readonly RoleMeta[]): Tier | undefined {
  const configured = roles?.find((r) => r.name === role)?.tier;
  return configured && configured !== rowTier ? configured : undefined;
}

const share = (usd: number, total: number) => (total > 0 ? usd / total : 0);

/** Groups rows by key and sums them; `tierFor` picks each group's tier; sorted by cost desc; shares are of `total` (default: all rows). */
export function aggregateBy(rows: readonly TieredRow[], key: (r: TieredRow) => string, tierFor: (key: string, rows: TieredRow[]) => TierKey, total = sumUsage(rows).cost_usd): AggRow[] {
  return groupBy([...rows], key)
    .map(({ key: k, rows: rs }) => {
      const u = sumUsage(rs);
      return { key: k, tier: tierFor(k, rs), count: rs.length, share: share(u.cost_usd, total), rerouted: sumRerouted(rs), ...u };
    })
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

/** One row per model; a model has exactly one tier. */
export const byModel = (rows: readonly TieredRow[]) => aggregateBy(rows, (r) => r.model, (_, rs) => rs[0]!.tier);

/** One row per role; its tier is the configured one, else the tier of its costliest model row. */
export function byRole(rows: readonly TieredRow[], roles?: readonly RoleMeta[]): AggRow[] {
  const top = (rs: TieredRow[]) => rs.reduce((a, b) => (b.cost_usd > a.cost_usd ? b : a)).tier;
  return aggregateBy(rows, (r) => r.role, (k, rs) => roles?.find((r) => r.name === k)?.tier ?? top(rs));
}

/** Per-tier subtotals in TIER_ORDER (empty tiers skipped); their costs add up to the overall total. */
export function tierSubtotals(rows: readonly TieredRow[], total = sumUsage(rows).cost_usd): AggRow[] {
  const by = new Map(groupBy([...rows], (r) => r.tier).map((g) => [g.key, g.rows]));
  return TIER_ORDER.flatMap((t) => {
    const rs = by.get(t);
    if (!rs) return [];
    const u = sumUsage(rs);
    return [{ key: t, tier: t, count: rs.length, share: share(u.cost_usd, total), rerouted: sumRerouted(rs), ...u }];
  });
}
