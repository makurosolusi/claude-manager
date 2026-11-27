import { join } from "node:path";
import { appDir, claudeStateFile } from "../app.paths.ts";
import { readJson, sha256 } from "../storage/json.file.ts";

/** USD per million tokens (webSearchRequests: USD per request). Same shape as Claude Code's additionalModelCostsCache. */
export interface Rates {
  inputTokens: number;
  outputTokens: number;
  promptCacheWriteTokens: number;
  promptCacheWrite1hTokens: number;
  promptCacheReadTokens: number;
  webSearchRequests?: number;
  fast?: Partial<Rates>;
  longPrompt?: Partial<Rates> & { abovePromptTokens: number };
}
export type PricingTable = Record<string, Rates>;

export interface Usage {
  input: number;
  cache_5m: number;
  cache_1h: number;
  cache_read: number;
  output: number;
  web_search: number;
  speed: string | null;
  geo: string | null;
}

const WEB_SEARCH_USD = 0.01;
const US_GEO_MULTIPLIER = 1.1;
const rates = (input: number, output: number, w5m: number, w1h: number, read: number, extra: Partial<Rates> = {}): Rates => ({
  inputTokens: input,
  outputTokens: output,
  promptCacheWriteTokens: w5m,
  promptCacheWrite1hTokens: w1h,
  promptCacheReadTokens: read,
  webSearchRequests: WEB_SEARCH_USD,
  ...extra,
});
const fast2x = (r: Rates): Rates => ({
  ...r,
  fast: {
    inputTokens: r.inputTokens * 2,
    outputTokens: r.outputTokens * 2,
    promptCacheWriteTokens: r.promptCacheWriteTokens * 2,
    promptCacheWrite1hTokens: r.promptCacheWrite1hTokens * 2,
    promptCacheReadTokens: r.promptCacheReadTokens * 2,
  },
});

// Fallback when neither pricing.json nor Claude Code's cache knows a model. Source: RND/02 §7 (2026-11-27).
const opus45 = rates(5, 25, 6.25, 10, 0.5);
const sonnet45 = rates(3, 15, 3.75, 6, 0.3);
export const DEFAULT_PRICING: PricingTable = {
  "claude-fable-5-2": fast2x(rates(8, 40, 10, 16, 0.2)),
  "claude-opus-5-5": fast2x(rates(4, 20, 5, 8, 0.2)),
  "claude-opus-5": fast2x(opus45),
  "claude-opus-4-8": fast2x(opus45),
  "claude-opus-4-7": opus45,
  "claude-opus-4-6": opus45,
  "claude-opus-4-5": opus45,
  "claude-sonnet-5-5": rates(2, 10, 2.5, 4, 0.1),
  "claude-sonnet-5": rates(2, 10, 2.5, 4, 0.2),
  "claude-sonnet-4-6": sonnet45,
  "claude-sonnet-4-5": sonnet45,
  "claude-haiku-5-5": rates(0.1, 0.5, 0.125, 0.2, 0.01, {
    longPrompt: { abovePromptTokens: 100_000, inputTokens: 0.5, outputTokens: 2.5, promptCacheWriteTokens: 0.625, promptCacheWrite1hTokens: 1, promptCacheReadTokens: 0.05 },
  }),
  "claude-haiku-4-5": rates(1, 5, 1.25, 2, 0.1),
};

export interface Pricing {
  table: PricingTable;
  /** Changes whenever any rate changes; stored per request so stale costs get recomputed. */
  version: string;
}

export const pricingPath = () => join(appDir(), "pricing.json");

/** Resolution order (last wins per model): built-in defaults → Claude Code's local cache → ~/.claude-manager/pricing.json. */
export async function loadPricing(): Promise<Pricing> {
  // Claude Code rewrites this file constantly; a torn/invalid read just means "use the other sources".
  const state = await readJson<{ additionalModelCostsCache?: PricingTable }>(claudeStateFile()).catch(() => undefined);
  const table = {
    ...DEFAULT_PRICING,
    ...state?.additionalModelCostsCache,
    ...(await readJson<PricingTable>(pricingPath())),
  };
  return { table, version: sha256(JSON.stringify(table)).slice(0, 12) };
}

/** Exact id, else without the date / [1m] suffix. No fuzzy match: an unknown model is reported, not mispriced. */
export const ratesFor = (table: PricingTable, model: string): Rates | undefined =>
  table[model] ?? table[model.replace(/\[.*$/, "").replace(/-\d{8}$/, "")];

/** USD for one API request; undefined when the model has no known rates. */
export function requestCost(u: Usage, base: Rates | undefined): number | undefined {
  if (!base) return undefined;
  let r: Rates = base;
  const promptTokens = u.input + u.cache_5m + u.cache_1h + u.cache_read;
  if (base.longPrompt && promptTokens > base.longPrompt.abovePromptTokens) r = { ...r, ...base.longPrompt };
  if (u.speed === "fast" && base.fast) r = { ...r, ...base.fast };
  const cost =
    (u.input * r.inputTokens +
      u.cache_5m * r.promptCacheWriteTokens +
      u.cache_1h * r.promptCacheWrite1hTokens +
      u.cache_read * r.promptCacheReadTokens +
      u.output * r.outputTokens) /
      1e6 +
    u.web_search * (r.webSearchRequests ?? WEB_SEARCH_USD);
  // ponytail: applies the US-only uplift to every model; officially it is 4.6+ only (pre-4.6 + geo=us is rare).
  return u.geo === "us" ? cost * US_GEO_MULTIPLIER : cost;
}
