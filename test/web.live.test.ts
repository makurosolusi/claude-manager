import { expect, test } from "bun:test";
import type { LiveSession, ProjectRow } from "../src/server/dashboard.types.ts";
import { LIVE_SPEC, levelOf, liveTableOptions, usedPct } from "../src/web/lib/live.table.ts";
import { PROJECTS_SPEC, parentOf, projectTableOptions, projectTotals } from "../src/web/lib/projects.table.ts";
import { parseTableQuery } from "../src/web/lib/table.query.ts";
import { runClientTable } from "../src/web/lib/table.client.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const live = (id: string, used: number, min: number, model = "claude-opus-4-7"): LiveSession => ({
  id, title: id, project_cwd: "/w/acme/web", model, last_ts: ago(min), context_used: used, context_window: 200, context_left_pct: 100 - used / 2, cost_usd: used,
});
const proj = (project: string, cost: number, min: number): ProjectRow => ({
  project, sessions: 2, last_ts: ago(min), key: project, requests: 10, input: 10, output: 5, cache_read: 80, cache_write: 10, cost_usd: cost, unpriced: 0,
} as ProjectRow);

test("usedPct rounds and survives a zero window", () => {
  expect(usedPct({ context_used: 142, context_window: 200 })).toBe(71);
  expect(usedPct({ context_used: 5, context_window: 0 })).toBe(0);
});

test("level maps 70/90 thresholds", () => {
  const lv = (pct: number) => levelOf({ ...live("a", 0, 1), context_used: pct, context_window: 100 });
  expect([69, 70, 89, 90].map(lv)).toEqual(["ok", "warn", "warn", "danger"]);
});

test("live status facet follows last_ts age and filters rows", () => {
  const rows = [live("fresh", 10, 2), live("idle", 10, 10), live("old", 10, 40)];
  const r = runClientTable(rows, { ...parseTableQuery(new URLSearchParams("status=idle"), LIVE_SPEC) }, liveTableOptions(NOW));
  expect(r.filtered.map((s) => s.id)).toEqual(["idle"]);
  expect([...r.counts.status!]).toEqual([["live", 1], ["idle", 1], ["ended", 1]]);
});

test("live default sort is context desc and family facet reads the model", () => {
  const rows = [live("lo", 20, 1), live("hi", 180, 1, "claude-haiku-4-5"), live("mid", 100, 1)];
  const s = parseTableQuery(new URLSearchParams(), LIVE_SPEC);
  expect(runClientTable(rows, s, liveTableOptions(NOW)).filtered.map((x) => x.id)).toEqual(["hi", "mid", "lo"]);
  const h = parseTableQuery(new URLSearchParams("family=haiku&family=bogus"), LIVE_SPEC);
  expect(h.filters.family).toEqual(["haiku"]);
  expect(runClientTable(rows, h, liveTableOptions(NOW)).filtered.map((x) => x.id)).toEqual(["hi"]);
});

test("parentOf takes the first segment of the display path", () => {
  expect(parentOf("/Users/me/acme/web")).toBe("acme");
  expect(parentOf("/web")).toBe("web");
});

test("projects default to cost desc, search matches the full path, status facet applies", () => {
  const rows = [proj("/w/acme/web", 5, 2), proj("/w/acme/api", 9, 60), proj("/w/zed/cli", 1, 10)];
  const o = projectTableOptions(NOW);
  const d = parseTableQuery(new URLSearchParams(), PROJECTS_SPEC);
  expect(runClientTable(rows, d, o).filtered.map((r) => parentOf(r.project) + ":" + r.cost_usd)).toEqual(["acme:9", "acme:5", "zed:1"]);
  expect(runClientTable(rows, parseTableQuery(new URLSearchParams("q=/w/zed"), PROJECTS_SPEC), o).total).toBe(1);
  expect(runClientTable(rows, parseTableQuery(new URLSearchParams("status=live"), PROJECTS_SPEC), o).filtered).toHaveLength(1);
});

test("projectTotals sums usage and picks the latest activity", () => {
  const t = projectTotals([proj("/a/b", 2, 30), proj("/a/c", 3, 5)]);
  expect(t).toMatchObject({ sessions: 4, requests: 20, tokens: 210, cost: 5 });
  expect(t.last).toBe(ago(5));
  expect(t.cache).toBeCloseTo(160 / 200);
});
