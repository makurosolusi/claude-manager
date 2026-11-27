import { expect, test } from "bun:test";
import { cacheHitRate, fmtDelta, fmtDuration, fmtModel, fmtPct, fmtProject, fmtRelative } from "../src/web/lib/format.ts";
import { modelFamily, normalizeModel, tierOf, type Tiers } from "../src/web/lib/model.tier.ts";
import { DEFAULT_RANGE, parseRange } from "../src/web/lib/range.ts";
import { contextLevel } from "../src/web/lib/context.level.ts";
import { nextSort } from "../src/web/components/data.table.tsx";
import { syncState } from "../src/web/components/sync.indicator.tsx";

const NOW = new Date(2026, 10, 27, 12, 0, 0).getTime(); // local time so date labels don't depend on TZ
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test("fmtRelative buckets ages", () => {
  expect(fmtRelative(null, NOW)).toBe("—");
  expect(fmtRelative("nope", NOW)).toBe("—");
  expect(fmtRelative(ago(44 * S), NOW)).toBe("just now");
  expect(fmtRelative(ago(-5 * M), NOW)).toBe("just now"); // future (clock skew)
  expect(fmtRelative(ago(45 * S), NOW)).toBe("1m ago");
  expect(fmtRelative(ago(12 * M), NOW)).toBe("12m ago");
  expect(fmtRelative(ago(5 * H + 59 * M), NOW)).toBe("5h ago");
  expect(fmtRelative(ago(3 * D), NOW)).toBe("3d ago");
  expect(fmtRelative(new Date(2026, 10, 3, 9).toISOString(), NOW)).toBe("Nov 3");
  expect(fmtRelative(new Date(2025, 10, 3, 9).toISOString(), NOW)).toBe("Nov 3, 2025");
});

test("fmtProject keeps the last two segments", () => {
  expect(fmtProject("/Users/me/acme/web")).toBe("acme/web");
  expect(fmtProject("/Users/me/side/web/")).toBe("side/web");
  expect(fmtProject("C:\\code\\acme\\api")).toBe("acme/api");
  expect(fmtProject("/web")).toBe("web");
  expect(fmtProject(null)).toBe("—");
});

test("fmtModel strips vendor prefix, date and [1m]", () => {
  expect(fmtModel("claude-opus-4-7")).toBe("opus-4-7");
  expect(fmtModel("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
  expect(fmtModel("claude-sonnet-4-5[1m]")).toBe("sonnet-4-5");
  expect(fmtModel("gpt-x")).toBe("gpt-x");
  expect(fmtModel(null)).toBe("—");
});

test("fmtDelta, fmtPct, fmtDuration, cacheHitRate", () => {
  expect(fmtDelta(112.4, 100)).toBeCloseTo(12.4);
  expect(fmtDelta(50, 100)).toBe(-50);
  expect(fmtDelta(5, 0)).toBeNull();
  expect(fmtDelta(5, null)).toBeNull();
  expect(fmtPct(0.912)).toBe("91.2%");
  expect(fmtDuration(3 * S)).toBe("3s");
  expect(fmtDuration(125 * S)).toBe("2m");
  expect(fmtDuration(-1)).toBe("0s");
  expect(cacheHitRate({ input: 10, cache_read: 80, cache_write: 10 })).toBe(0.8);
  expect(cacheHitRate({ input: 0, cache_read: 0, cache_write: 0 })).toBe(0);
});

test("modelFamily by substring", () => {
  expect(modelFamily("claude-opus-4-7")).toBe("opus");
  expect(modelFamily("Claude-Sonnet-4-5")).toBe("sonnet");
  expect(modelFamily("claude-3-5-haiku-20241022")).toBe("haiku");
  expect(modelFamily("<synthetic>")).toBe("other");
});

test("tierOf: config match wins, then family, else other", () => {
  const tiers: Tiers = { think: "claude-sonnet-4-5", work: "claude-haiku-4-5", basic: "claude-haiku-3" };
  expect(tierOf("claude-sonnet-4-5", tiers)).toBe("think"); // config overrides sonnet→work
  expect(tierOf("claude-sonnet-4-5-20250929[1m]", tiers)).toBe("think"); // suffixes normalized
  expect(tierOf("CLAUDE-HAIKU-4-5", tiers)).toBe("work");
  expect(tierOf("claude-opus-4-7", tiers)).toBe("think"); // family fallback
  expect(tierOf("claude-sonnet-4-0", tiers)).toBe("work");
  expect(tierOf("claude-haiku-4-0")).toBe("basic"); // no config yet
  expect(tierOf("gpt-x", tiers)).toBe("other");
  expect(normalizeModel("claude-opus-4-7-20260101[1m]")).toBe("claude-opus-4-7");
});

test("parseRange falls back to the default", () => {
  expect(parseRange("7d")).toBe("7d");
  expect(parseRange("all")).toBe("all");
  expect(parseRange(null)).toBe(DEFAULT_RANGE);
  expect(parseRange("1y")).toBe(DEFAULT_RANGE);
  expect(parseRange("toString")).toBe(DEFAULT_RANGE); // no prototype keys
});

test("contextLevel thresholds", () => {
  expect(contextLevel(69)).toBe("ok");
  expect(contextLevel(70)).toBe("warn");
  expect(contextLevel(90)).toBe("danger");
});

test("nextSort: new column desc, same column toggles", () => {
  expect(nextSort(undefined, "cost")).toEqual({ key: "cost", dir: "desc" });
  expect(nextSort({ key: "cost", dir: "desc" }, "cost")).toEqual({ key: "cost", dir: "asc" });
  expect(nextSort({ key: "cost", dir: "asc" }, "cost")).toEqual({ key: "cost", dir: "desc" });
  expect(nextSort({ key: "cost", dir: "asc" }, "last")).toEqual({ key: "last", dir: "desc" });
});

test("syncState: connecting, ok, stalled, failed", () => {
  const meta = { synced_at: ago(10 * S), changed_at: null, error: null, interval_ms: 5 * S };
  expect(syncState(undefined, NOW)).toBe("connecting");
  expect(syncState(meta, NOW)).toBe("ok");
  expect(syncState({ ...meta, synced_at: ago(16 * S) }, NOW)).toBe("stalled");
  expect(syncState({ ...meta, error: "disk full" }, NOW)).toBe("failed");
});
