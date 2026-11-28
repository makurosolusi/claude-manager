import type { Tier } from "../config/config.store.ts";

export interface TierModelOption { id: string; input_usd: number | null; output_usd: number | null; in_pricing: boolean; requests_30d: number }
export interface TierSummary {
  tier: Tier; alias: "opus" | "sonnet" | "haiku"; env: string; model: string;
  requests_30d: number; cost_30d: number; unpriced_30d: number; // requests served by `model` (normalized match)
  /** Same 30-day tokens re-priced per option id (incl. the current model as baseline); null = no rates. */
  estimate_30d: Record<string, number | null>;
}
export interface TiersResponse { tiers: TierSummary[]; models: TierModelOption[]; etag: string; days: number }
export interface TierWriteResult { tier: Tier; model: string; previous: string; applied: number; etag: string }
