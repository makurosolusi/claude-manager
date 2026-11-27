import type { UsageRow } from "../../server/dashboard.types.ts";
import { TIER_ORDER, tierOf, type TierKey, type Tiers } from "./model.tier.ts";

type Sums = Pick<UsageRow, "requests" | "input" | "cache_read" | "cache_write" | "cost_usd" | "unpriced">;
/** One model inside a tier, with its share of the overall cost (0..1). */
export interface TierModelRow extends Sums { model: string; share: number }
/** One tier's totals, its share of the overall cost (0..1) and its models by cost desc. */
export interface TierRow extends Sums { tier: TierKey; share: number; models: TierModelRow[] }

/** Tiers always shown even with no usage; "other" only appears when a model lands in it. */
const ALWAYS_SHOWN: readonly TierKey[] = ["think", "work", "basic"];

const zero = (): Sums => ({ requests: 0, input: 0, cache_read: 0, cache_write: 0, cost_usd: 0, unpriced: 0 });
const SUM_KEYS = Object.keys(zero()) as (keyof Sums)[];

/** Groups per-model usage into tier rows (config match first, family fallback) in TIER_ORDER. */
export function costByTier(byModel: UsageRow[], tiers?: Partial<Tiers>): TierRow[] {
  const total = byModel.reduce((s, r) => s + r.cost_usd, 0);
  const share = (usd: number) => (total > 0 ? usd / total : 0);
  const groups = new Map<TierKey, TierRow>();
  for (const t of ALWAYS_SHOWN) groups.set(t, { tier: t, share: 0, models: [], ...zero() });
  for (const r of byModel) {
    const t = tierOf(r.key, tiers);
    const g = groups.get(t) ?? { tier: t, share: 0, models: [], ...zero() };
    groups.set(t, g);
    for (const k of SUM_KEYS) g[k] += r[k];
    const { key, ...sums } = r;
    g.models.push({ model: key, share: share(r.cost_usd), ...sums });
  }
  return TIER_ORDER.flatMap((t) => {
    const g = groups.get(t);
    if (!g) return [];
    g.share = share(g.cost_usd);
    g.models.sort((a, b) => b.cost_usd - a.cost_usd);
    return [g];
  });
}
