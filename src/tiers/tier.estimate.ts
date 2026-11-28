import type { TierBucket } from "../db/tiers.repository.ts";
import { requestCost, type Rates } from "../ingest/pricing.service.ts";

/**
 * USD of the same tokens priced at `base`; null when the rates are unknown.
 * Costs are linear in token sums, so one requestCost call per bucket equals the sum over its requests.
 * Long-prompt rates are merged by hand (the bucket's `long` flag was computed per request) and `longPrompt` is
 * dropped so requestCost does not re-test the summed tokens against the threshold.
 */
export function reprice(buckets: readonly TierBucket[], base: Rates | undefined): number | null {
  if (!base) return null;
  let total = 0;
  for (const b of buckets) {
    const rates: Rates = { ...base, ...(b.long ? base.longPrompt : undefined), longPrompt: undefined };
    const usage = { ...b, speed: b.fast ? "fast" : null, geo: b.us ? "us" : null };
    total += requestCost(usage, rates) ?? 0;
  }
  return total;
}
