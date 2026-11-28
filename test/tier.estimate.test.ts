import { describe, expect, test } from "bun:test";
import type { TierBucket } from "../src/db/tiers.repository.ts";
import { requestCost, type Rates } from "../src/ingest/pricing.service.ts";
import { reprice } from "../src/tiers/tier.estimate.ts";

// test-only fixtures: synthetic rates and token counts.
const BASE: Rates = {
  inputTokens: 2, outputTokens: 10, promptCacheWriteTokens: 2.5, promptCacheWrite1hTokens: 4, promptCacheReadTokens: 0.2,
  fast: { inputTokens: 4, outputTokens: 20, promptCacheWriteTokens: 5, promptCacheWrite1hTokens: 8, promptCacheReadTokens: 0.4 },
  longPrompt: { abovePromptTokens: 1000, inputTokens: 5, outputTokens: 25, promptCacheWriteTokens: 6, promptCacheWrite1hTokens: 9, promptCacheReadTokens: 0.5 },
};
const bucket = (o: Partial<TierBucket> = {}): TierBucket => ({
  model: "m", fast: false, us: false, long: false, requests: 1, input: 500, cache_5m: 100, cache_1h: 50, cache_read: 200, output: 300,
  web_search: 0, cost_usd: 0, unpriced: 0, ...o,
});
const usage = (b: TierBucket, over: object = {}) => ({ ...b, speed: b.fast ? "fast" : null, geo: b.us ? "us" : null, ...over });

describe("reprice", () => {
  test("unknown rates return null", () => expect(reprice([bucket()], undefined)).toBeNull());

  test("a long bucket uses the longPrompt rates", () => {
    const b = bucket({ long: true });
    const long = (500 * 5 + 100 * 6 + 50 * 9 + 200 * 0.5 + 300 * 25) / 1e6;
    expect(reprice([b], BASE)).toBeCloseTo(long, 12);
    expect(reprice([b], BASE)).toBeGreaterThan(reprice([bucket()], BASE)!);
  });

  test("a short bucket never triggers longPrompt even when its sums exceed the threshold", () => {
    const b = bucket({ input: 5000, requests: 10 });
    expect(reprice([b], BASE)).toBeCloseTo((5000 * 2 + 100 * 2.5 + 50 * 4 + 200 * 0.2 + 300 * 10) / 1e6, 12);
  });

  test("fast, geo and web search match requestCost", () => {
    const b = bucket({ fast: true, us: true, web_search: 3 });
    expect(reprice([b], BASE)).toBeCloseTo(requestCost(usage(b), { ...BASE, longPrompt: undefined })!, 12);
    expect(reprice([b], BASE)).toBeGreaterThan(reprice([bucket()], BASE)! * 2);
  });

  test("repricing at the current rates equals the sum of per-request requestCost", () => {
    const reqs = [
      { input: 100, cache_5m: 0, cache_1h: 0, cache_read: 50, output: 20, web_search: 0, speed: null, geo: "us" },
      { input: 100, cache_5m: 0, cache_1h: 0, cache_read: 50, output: 20, web_search: 1, speed: "fast", geo: "us" },
      { input: 900, cache_5m: 10, cache_1h: 0, cache_read: 500, output: 40, web_search: 0, speed: null, geo: null },
      { input: 2000, cache_5m: 0, cache_1h: 0, cache_read: 0, output: 5, web_search: 0, speed: null, geo: null },
    ];
    const expected = reqs.reduce((n, u) => n + requestCost(u, BASE)!, 0);
    const sum = (rs: typeof reqs, long: boolean): TierBucket => {
      const t = (k: "input" | "cache_5m" | "cache_1h" | "cache_read" | "output" | "web_search") => rs.reduce((n, u) => n + u[k], 0);
      return bucket({ long, fast: rs[0]!.speed === "fast", us: rs[0]!.geo === "us", requests: rs.length, input: t("input"), cache_5m: t("cache_5m"), cache_1h: t("cache_1h"), cache_read: t("cache_read"), output: t("output"), web_search: t("web_search") });
    };
    // groups of identical flags: [0] short us, [1] short fast us, [2]+[3] long (prompt tokens 1410 and 2000 > 1000)
    const buckets = [sum([reqs[0]!], false), sum([reqs[1]!], false), sum([reqs[2]!, reqs[3]!], true)];
    expect(reprice(buckets, BASE)).toBeCloseTo(expected, 12);
  });
});
