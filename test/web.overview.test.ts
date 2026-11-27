import { expect, test } from "bun:test";
import type { DayModelRow, Totals, UsageRow } from "../src/server/dashboard.types.ts";
import { costByTier } from "../src/web/lib/tier.cost.ts";
import { pivotCostByDay } from "../src/web/components/cost.chart.tsx";
import { overviewDeltas } from "../src/web/pages/overview.page.tsx";
import { FAMILY_COLOR, FAMILY_LABEL, type Tiers } from "../src/web/lib/model.tier.ts";

// test-only fixtures
const row = (key: string, cost_usd: number, requests = 10): UsageRow => ({ key, cost_usd, requests, input: 100, output: 50, cache_read: 300, cache_write: 100, unpriced: 0 });
const tot = (o: Partial<Totals>): Totals => ({ requests: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, unpriced: 0, sessions: 0, ...o });

test("costByTier: family fallback, fixed order, empty tiers kept, other only when present", () => {
  const tiers = costByTier([row("claude-haiku-4-5", 1), row("claude-opus-4-7", 6), row("claude-sonnet-4-5", 3)]);
  expect(tiers.map((t) => t.tier)).toEqual(["think", "work", "basic"]);
  expect(tiers.map((t) => t.share)).toEqual([0.6, 0.3, 0.1]);
  expect(costByTier([]).map((t) => [t.tier, t.cost_usd])).toEqual([["think", 0], ["work", 0], ["basic", 0]]);
  const withOther = costByTier([row("gpt-x", 2), row("claude-opus-4-7", 2)]);
  expect(withOther.map((t) => t.tier)).toEqual(["think", "work", "basic", "other"]);
  expect(withOther[3]!.models[0]!.model).toBe("gpt-x");
});

test("costByTier: configured tier model beats family, sums and sorts sub-rows", () => {
  const cfg: Tiers = { think: "claude-sonnet-4-5", work: "claude-haiku-4-5", basic: "claude-haiku-3" };
  const tiers = costByTier([row("claude-sonnet-4-5[1m]", 4, 5), row("claude-opus-4-7", 8, 7), row("claude-haiku-4-5-20251001", 2)], cfg);
  const think = tiers.find((t) => t.tier === "think")!;
  expect(think.models.map((m) => m.model)).toEqual(["claude-opus-4-7", "claude-sonnet-4-5[1m]"]); // opus via family, sonnet via config
  expect(think.cost_usd).toBe(12);
  expect(think.requests).toBe(12);
  expect(tiers.find((t) => t.tier === "work")!.models.map((m) => m.model)).toEqual(["claude-haiku-4-5-20251001"]);
  expect(tiers.find((t) => t.tier === "basic")!.cost_usd).toBe(0);
});

test("costByTier: shares sum to 100%", () => {
  const tiers = costByTier([row("claude-opus-4-7", 1.37), row("claude-sonnet-4-5", 2.11), row("claude-haiku-4-5", 0.29), row("mystery", 0.5)]);
  expect(tiers.reduce((s, t) => s + t.share, 0)).toBeCloseTo(1, 10);
  expect(tiers.flatMap((t) => t.models).reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 10);
});

test("overviewDeltas: % for counts, pt for cache hit, null without baseline", () => {
  expect(overviewDeltas(tot({ requests: 5 }), null)).toBeNull();
  const cur = tot({ cost_usd: 15, requests: 90, sessions: 4, input: 10, cache_read: 80, cache_write: 10 }); // hit 80%
  const prev = tot({ cost_usd: 10, requests: 100, sessions: 10, input: 30, cache_read: 60, cache_write: 10 }); // hit 60%
  const d = overviewDeltas(cur, prev)!;
  expect(d.cost.value).toBeCloseTo(50);
  expect(d.requests.value).toBeCloseTo(-10);
  expect(d.sessions.value).toBeCloseTo(-60);
  expect(d.cacheHit.value).toBeCloseTo(20);
  expect(overviewDeltas(cur, tot({ requests: 3 }))!.cacheHit.value).toBeNull();
});

test("overviewDeltas: tiny baseline or >500% falls back to the previous value", () => {
  const small = overviewDeltas(tot({ cost_usd: 500, requests: 900, sessions: 40 }), tot({ cost_usd: 0.23, requests: 7, sessions: 2 }))!;
  expect(small.cost).toEqual({ value: null, prevLabel: "$0.23", trend: "up" });
  expect(small.requests).toEqual({ value: null, prevLabel: "7", trend: "up" });
  expect(small.sessions.prevLabel).toBe("2");
  // baseline above the minimum but change beyond DELTA_MAX_PCT
  const big = overviewDeltas(tot({ cost_usd: 100, requests: 1000 }), tot({ cost_usd: 8.23, requests: 100 }))!;
  expect(big.cost).toEqual({ value: null, prevLabel: "$8.23", trend: "up" });
  expect(big.requests).toEqual({ value: null, prevLabel: "100", trend: "up" });
  // exactly 500% is still a percentage
  expect(overviewDeltas(tot({ requests: 600 }), tot({ requests: 100 }))!.requests.value).toBeCloseTo(500);
  // empty previous period
  expect(overviewDeltas(tot({ cost_usd: 5, requests: 5, sessions: 1 }), tot({}))!.cost).toEqual({ value: null, isNew: true });
});

test("pivotCostByDay: stacks by family, sums match the day total, unknown models go to other", () => {
  const rows: DayModelRow[] = [
    { day: "2026-11-01", model: "claude-opus-4-7", cost_usd: 5, requests: 1 },
    { day: "2026-11-03", model: "claude-opus-4-5", cost_usd: 4, requests: 1 },
    { day: "2026-11-03", model: "claude-opus-4-7", cost_usd: 2, requests: 1 },
    { day: "2026-11-03", model: "claude-sonnet-4-5", cost_usd: 3, requests: 1 },
    { day: "2026-11-03", model: "mystery-model", cost_usd: 1, requests: 1 },
  ];
  const { series, points, models } = pivotCostByDay(rows, "2026-10-31", "2026-11-03");
  expect(points.map((p) => p.day)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  expect(series.map((s) => [s.key, s.color])).toEqual([
    ["opus", FAMILY_COLOR.opus],
    ["sonnet", FAMILY_COLOR.sonnet],
    ["other", FAMILY_COLOR.other],
  ]);
  const last = points[3]!;
  expect(series.map((s) => last[s.key])).toEqual([6, 3, 1]);
  expect(series.reduce((sum, s) => sum + (last[s.key] as number), 0)).toBe(10);
  expect(points[2]!.opus).toBe(0);
  expect(models["2026-11-03"]!.opus).toEqual({ "claude-opus-4-5": 4, "claude-opus-4-7": 2 });
  expect(models["2026-11-03"]!.other).toEqual({ "mystery-model": 1 });
});

test("pivotCostByDay: per-day family sums equal raw totals for every day", () => {
  const rows: DayModelRow[] = [
    { day: "2026-11-01", model: "claude-haiku-4-5", cost_usd: 0.25, requests: 1 },
    { day: "2026-11-01", model: "claude-sonnet-4-5", cost_usd: 0.5, requests: 1 },
    { day: "2026-11-02", model: "gpt-x", cost_usd: 1.5, requests: 1 },
  ];
  const { series, points } = pivotCostByDay(rows, "2026-11-01", "2026-11-02");
  const totals = points.map((p) => series.reduce((s, x) => s + (p[x.key] as number), 0));
  expect(totals).toEqual([0.75, 1.5]);
  expect(series.map((s) => s.key)).toEqual(["sonnet", "haiku", "other"]);
});

test("FAMILY_LABEL names every family", () => {
  expect(Object.keys(FAMILY_LABEL).sort()).toEqual(Object.keys(FAMILY_COLOR).sort());
  expect(FAMILY_LABEL).toEqual({ opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable", other: "Other" });
});
