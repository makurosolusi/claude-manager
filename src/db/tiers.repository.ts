import type { Database } from "bun:sqlite";
import { FROM, NORMALIZE_SQL, type Params } from "./stats.repository.ts";

/** Token sums of requests that share a normalized model and the same price-relevant flags. */
export interface TierBucket {
  model: string;
  fast: boolean;
  us: boolean;
  /** Prompt tokens above the threshold the query was run with (long-prompt rates apply). */
  long: boolean;
  requests: number;
  input: number;
  cache_5m: number;
  cache_1h: number;
  cache_read: number;
  output: number;
  web_search: number;
  cost_usd: number;
  /** Requests whose model has no known rates (excluded from cost_usd). */
  unpriced: number;
}

/** Normalized model with its request count. */
export interface ModelCount {
  model: string;
  requests: number;
}

const MODEL = NORMALIZE_SQL("r.model");

/**
 * Token buckets since `since` (ISO) for requests served by one of `models` (already normalized), one grouped query.
 * `threshold` splits each model into short/long prompts (use Number.MAX_SAFE_INTEGER for "never long").
 */
export function tierBuckets(db: Database, since: string, models: string[], threshold: number): TierBucket[] {
  const promptTokens = "(r.input + r.cache_5m + r.cache_1h + r.cache_read)";
  const rows = db
    .query<Record<string, string | number>, Params>(
      `SELECT ${MODEL} AS model, (r.speed = 'fast') AS fast, (r.geo = 'us') AS us, (${promptTokens} > $threshold) AS long,
        COUNT(*) AS requests, SUM(r.input) AS input, SUM(r.cache_5m) AS cache_5m, SUM(r.cache_1h) AS cache_1h,
        SUM(r.cache_read) AS cache_read, SUM(r.output) AS output, SUM(r.web_search) AS web_search,
        COALESCE(SUM(r.cost_usd), 0) AS cost_usd, SUM(r.cost_usd IS NULL) AS unpriced
      ${FROM} WHERE r.ts >= $since AND ${MODEL} IN (SELECT value FROM json_each($models))
      GROUP BY model, fast, us, long`,
    )
    .all({ since, models: JSON.stringify(models), threshold });
  return rows.map((r) => ({ ...r, fast: !!r.fast, us: !!r.us, long: !!r.long }) as TierBucket);
}

/** Request count per normalized model since `since` (ISO); one grouped query. */
export function modelCounts(db: Database, since: string): ModelCount[] {
  return db
    .query<ModelCount, Params>(`SELECT ${MODEL} AS model, COUNT(*) AS requests ${FROM} WHERE r.ts >= $since GROUP BY model`)
    .all({ since });
}
