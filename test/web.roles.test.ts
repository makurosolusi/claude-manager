import { expect, test } from "bun:test";
import type { RoleRow } from "../src/server/dashboard.types.ts";
import type { RoleMeta } from "../src/web/lib/color.tokens.ts";
import { costByTier } from "../src/web/lib/tier.cost.ts";
import { byModel, byRole, configuredTierMismatch, byTierOrder, cacheHitLabel, roleKind, sumUsage, tierSubtotals, withTier } from "../src/web/lib/roles.aggregate.ts";

// test-only fixtures
const tiers = { think: "claude-opus-4-7", work: "claude-sonnet-4-5", basic: "claude-haiku-4-5" };
const roles: RoleMeta[] = [
  { name: "manager", tier: "think", source: "preset" },
  { name: "coder", tier: "work", source: "preset" },
  { name: "qa-bot", tier: "basic", source: "custom" },
];
const row = (role: string, model: string, cost: number, requests = 1): RoleRow =>
  ({ role, model, requests, input: 10, output: 5, cache_read: 20, cache_write: 1, cost_usd: cost, unpriced: 0, rerouted: 0 });
const data = [
  row("manager", "claude-opus-4-7", 10, 4),
  row("coder", "claude-opus-4-7", 6, 2), // configured work, billed think
  row("coder", "claude-sonnet-4-5", 3, 3),
  row("main", "claude-sonnet-4-5", 1),
  row("qa-bot", "mystery-model", 0.5),
];
const rows = withTier(data, tiers);

test("withTier uses config first, family fallback, other for unknown", () => {
  expect(rows.map((r) => r.tier)).toEqual(["think", "think", "work", "work", "other"]);
});

test("byModel and byRole sum usage, sort by cost and share the overall total", () => {
  const m = byModel(rows);
  expect(m.map((x) => [x.key, x.cost_usd, x.requests, x.count])).toEqual([
    ["claude-opus-4-7", 16, 6, 2], ["claude-sonnet-4-5", 4, 4, 2], ["mystery-model", 0.5, 1, 1],
  ]);
  expect(m.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  const r = byRole(rows, roles);
  expect(r.map((x) => x.key)).toEqual(["manager", "coder", "main", "qa-bot"]);
  expect(r.find((x) => x.key === "coder")).toMatchObject({ cost_usd: 9, tier: "work", input: 20 });
  expect(r.find((x) => x.key === "main")!.tier).toBe("work"); // no config: costliest row's tier
});

test("tier subtotals add up to the total and equal costByTier", () => {
  const total = sumUsage(rows).cost_usd;
  const sub = tierSubtotals(rows);
  expect(sub.map((t) => t.key)).toEqual(["think", "work", "other"]);
  expect(sub.reduce((s, t) => s + t.cost_usd, 0)).toBeCloseTo(total);
  expect(sub.reduce((s, t) => s + t.share, 0)).toBeCloseTo(1);
  const overview = costByTier(byModel(rows).map((m) => ({ ...m })), tiers);
  for (const t of overview.filter((o) => o.cost_usd > 0)) {
    const mine = sub.find((s) => s.key === t.tier)!;
    expect(mine.cost_usd).toBeCloseTo(t.cost_usd);
    expect(mine.requests).toBe(t.requests);
  }
});

test("configured tier mismatch is reported only when it differs", () => {
  const [mgr, codeThink, codeWork] = rows;
  expect(configuredTierMismatch(mgr!.role, mgr!.tier, roles)).toBeUndefined();
  expect(configuredTierMismatch(codeThink!.role, codeThink!.tier, roles)).toBe("work");
  expect(configuredTierMismatch(codeWork!.role, codeWork!.tier, roles)).toBeUndefined();
  expect(configuredTierMismatch("main", "think", roles)).toBeUndefined(); // not in the roster
  expect(configuredTierMismatch("coder", "think")).toBeUndefined(); // roster not loaded yet
});

test("roleKind comes from the roster only; everything else is external", () => {
  expect(roleKind("coder", roles)).toBe("preset");
  expect(roleKind("qa-bot", roles)).toBe("custom");
  for (const n of ["main", "subagent", "general-purpose", "Explore", "ghost"]) expect(roleKind(n, roles)).toBe("external");
  expect(roleKind("coder")).toBe("external"); // roster not loaded yet
});

test("cacheHitLabel is token-weighted, not an average of row rates", () => {
  const big = { ...sumUsage([]), requests: 1, input: 0, cache_read: 990, cache_write: 10 }; // 99%
  const small = { ...sumUsage([]), requests: 1, input: 10, cache_read: 0, cache_write: 0 }; // 0%
  expect(cacheHitLabel(sumUsage([big, small]))).toBe("98.0%");
  expect(cacheHitLabel(sumUsage([]))).toBe("—");
});

test("byTierOrder sorts think, work, basic, other", () => {
  const keys = byTierOrder([{ key: "other" }, { key: "basic" }, { key: "think" }, { key: "work" }]).map((g) => g.key);
  expect(keys).toEqual(["think", "work", "basic", "other"]);
});
