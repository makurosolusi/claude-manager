import type { Database } from "bun:sqlite";
import { configEtag } from "../config/config.apply.ts";
import { configPath, DEFAULT_TIER_MODELS, parseConfig, TIER_ALIAS, TIER_ENV, TIERS, type Config } from "../config/config.store.ts";
import { modelCounts, tierBuckets, type TierBucket } from "../db/tiers.repository.ts";
import { ratesFor, type Pricing } from "../ingest/pricing.service.ts";
import type { TierModelOption, TierSummary, TiersResponse } from "../server/tiers.types.ts";
import { MODEL_ID_RE } from "../roles/model.ids.ts";
import { readText } from "../install/install.target.ts";
import { reprice } from "./tier.estimate.ts";

/** Window of usage shown and re-priced. */
export const TIER_DAYS = 30;
const MS_PER_DAY = 86_400_000;
/** Threshold for rates without a long-prompt tier: no request is ever "long". */
const NEVER_LONG = Number.MAX_SAFE_INTEGER;

/** Mirrors `ratesFor`/SQL normalization: trim, lowercase, drop `[1m]`, then a trailing `-YYYYMMDD`. */
export const normalizeModelId = (id: string): string => id.trim().toLowerCase().replace(/\[1m\]$/, "").replace(/-\d{8}$/, "");

const thresholdOf = (id: string, pricing: Pricing) => ratesFor(pricing.table, id)?.longPrompt?.abovePromptTokens ?? NEVER_LONG;

/** The tier models and etag of ONE read of config.json, so the etag always describes the models shown. */
export interface TiersConfig { tiers: Config["tiers"]; etag: string }

/**
 * Reads config.json once and derives both the tier models and the etag from that same text (a separate
 * loadConfig + file read could straddle a write). A broken file is a server error (see parseConfig).
 */
export async function loadTiersConfig(): Promise<TiersConfig> {
  const path = configPath();
  const text = await readText(path);
  if (text === undefined) return { tiers: { ...DEFAULT_TIER_MODELS }, etag: configEtag(undefined) };
  return { tiers: parseConfig(text, path).tiers, etag: configEtag(text) };
}

/** Tier model editor data: per-tier 30-day usage served by the configured model, plus what the same tokens would cost on each known model. */
export function buildTiers(config: TiersConfig, db: Database, pricing: Pricing, now: Date): TiersResponse {
  const since = new Date(now.getTime() - TIER_DAYS * MS_PER_DAY).toISOString();
  const counts = new Map(modelCounts(db, since).map((c) => [c.model, c.requests]));
  const tierModel = Object.fromEntries(TIERS.map((t) => [t, normalizeModelId(config.tiers[t])]));

  const ids = new Set<string>();
  for (const raw of [...Object.keys(pricing.table), ...counts.keys(), ...Object.values(config.tiers)]) {
    const id = normalizeModelId(raw);
    if (MODEL_ID_RE.test(id)) ids.add(id);
  }
  const models: TierModelOption[] = [...ids].sort().map((id) => {
    const rates = ratesFor(pricing.table, id);
    return {
      id,
      input_usd: rates?.inputTokens ?? null,
      output_usd: rates?.outputTokens ?? null,
      in_pricing: !!rates,
      requests_30d: counts.get(id) ?? 0,
    };
  });

  // One bucket query per distinct long-prompt threshold (usually 1-2), each covering all three tiers: no N+1.
  const served = [...new Set(Object.values(tierModel))];
  const byThreshold = new Map<number, TierBucket[]>();
  for (const id of ids) {
    const t = thresholdOf(id, pricing);
    if (!byThreshold.has(t)) byThreshold.set(t, tierBuckets(db, since, served, t));
  }
  const bucketsFor = (model: string, threshold: number) => (byThreshold.get(threshold) ?? []).filter((b) => b.model === model);

  // ponytail: only requests served by the current tier model are re-priced; traffic that other models handled
  // (reroutes, earlier settings) is ignored. Upgrade: price all family traffic if the estimate must cover history.
  const tiers: TierSummary[] = TIERS.map((tier) => {
    const model = tierModel[tier]!;
    const own = bucketsFor(model, thresholdOf(model, pricing));
    const estimate_30d: Record<string, number | null> = {};
    for (const id of ids) estimate_30d[id] = reprice(bucketsFor(model, thresholdOf(id, pricing)), ratesFor(pricing.table, id));
    return {
      tier,
      alias: TIER_ALIAS[tier],
      env: TIER_ENV[tier],
      model: config.tiers[tier],
      requests_30d: own.reduce((n, b) => n + b.requests, 0),
      cost_30d: own.reduce((n, b) => n + b.cost_usd, 0),
      unpriced_30d: own.reduce((n, b) => n + b.unpriced, 0),
      estimate_30d,
    };
  });

  return { tiers, models, etag: config.etag, days: TIER_DAYS };
}
