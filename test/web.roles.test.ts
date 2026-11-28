import { expect, test } from "bun:test";
import type { RoleRow } from "../src/server/dashboard.types.ts";
import type { RoleMeta } from "../src/web/lib/color.tokens.ts";
import { costByTier } from "../src/web/lib/tier.cost.ts";
import { agentHref, flipsFor, groupRows, parseView, viewForKey } from "../src/web/lib/roles.view.ts";
import { configuredTierMismatch, cacheHitLabel, roleKind, sumUsage, withTier } from "../src/web/lib/roles.aggregate.ts";

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

test("group subtotals per model and per role sum usage and cover the overall total", () => {
  const m = groupRows(rows, "model");
  expect(m.map((g) => [g.key, sumUsage(g.rows).cost_usd, sumUsage(g.rows).requests, g.rows.length])).toEqual([
    ["claude-opus-4-7", 16, 6, 2], ["claude-sonnet-4-5", 4, 4, 2], ["mystery-model", 0.5, 1, 1],
  ]);
  const r = groupRows(rows, "role");
  expect(r.map((g) => g.key)).toEqual(["manager", "coder", "main", "qa-bot"]);
  expect(sumUsage(r.find((g) => g.key === "coder")!.rows)).toMatchObject({ cost_usd: 9, input: 20 });
  const total = sumUsage(rows).cost_usd;
  for (const groups of [m, r]) expect(groups.reduce((s, g) => s + sumUsage(g.rows).cost_usd, 0)).toBeCloseTo(total);
});

test("tier group subtotals add up to the total and equal costByTier", () => {
  const total = sumUsage(rows).cost_usd;
  const sub = groupRows(rows, "tier").map((g) => ({ key: g.key, ...sumUsage(g.rows) }));
  expect(sub.map((t) => t.key)).toEqual(["think", "work", "other"]);
  expect(sub.reduce((s, t) => s + t.cost_usd, 0)).toBeCloseTo(total);
  const perModel = groupRows(rows, "model").map((g) => ({ key: g.key, ...sumUsage(g.rows) }));
  const overview = costByTier(perModel, tiers);
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

// --- view switch (roles.view.ts) ---

test("parseView prefers ?view, maps legacy ?group, falls back to by role", () => {
  const p = (q: string) => parseView(new URLSearchParams(q));
  expect(p("")).toBe("role");
  expect(p("view=model")).toBe("model");
  expect(p("view=tier")).toBe("tier");
  expect(p("group=tier")).toBe("tier");
  expect(p("group=role")).toBe("role");
  expect(p("group=family")).toBe("model");
  expect(p("group=none")).toBe("role");
  expect(p("view=bogus&group=tier")).toBe("tier");
  expect(p("view=role&group=tier")).toBe("role");
});

test("groupRows by model sums per model and orders by cost; children are the roles", () => {
  const g = groupRows(rows, "model");
  expect(g.map((x) => x.key)).toEqual(["claude-opus-4-7", "claude-sonnet-4-5", "mystery-model"]);
  expect(g.map((x) => sumUsage(x.rows).cost_usd)).toEqual([16, 4, 0.5]);
  expect(g[0]!.rows.map((r) => r.role)).toEqual(["manager", "coder"]);
});

test("groupRows by role orders by cost and by tier follows think, work, basic, other", () => {
  expect(groupRows(rows, "role").map((x) => x.key)).toEqual(["manager", "coder", "main", "qa-bot"]);
  expect(groupRows(rows, "tier").map((x) => x.key)).toEqual(["think", "work", "other"]);
  expect(groupRows([], "role")).toEqual([]);
});

test("viewForKey wraps around and ignores other keys", () => {
  expect(viewForKey("role", "ArrowRight")).toBe("model");
  expect(viewForKey("tier", "ArrowRight")).toBe("role");
  expect(viewForKey("role", "ArrowLeft")).toBe("tier");
  expect(viewForKey("model", "Home")).toBe("role");
  expect(viewForKey("model", "End")).toBe("tier");
  expect(viewForKey("model", "a")).toBeUndefined();
});

test("agentHref links managed agents only, encoding the name", () => {
  expect(agentHref("coder")).toBe("#/agents/coder");
  expect(agentHref("my agent/x")).toBe("#/agents/my%20agent%2Fx");
  expect(agentHref("main")).toBeUndefined();
  expect(agentHref("subagent")).toBeUndefined();
});

test("flipsFor flips every key to reach the wanted open state", () => {
  expect(flipsFor(["a", "b"], true, true)).toEqual(["a", "b"]); // default closed, want open
  expect(flipsFor(["a", "b"], true, false)).toEqual([]);
  expect(flipsFor(["a", "b"], false, false)).toEqual(["a", "b"]);
  expect(flipsFor(["a", "b"], false, true)).toEqual([]);
});
