import { expect, test } from "bun:test";
import type { LiveSession, ProjectRow } from "../src/server/dashboard.types.ts";
import { LIVE_SPEC, levelOf, liveTableOptions, usedPct } from "../src/web/lib/live.table.ts";
import { bucketOf, folderOf, groupFromUrl, groupToUrl, orderBuckets, orderGroups, PROJECTS_SPEC, projectTableOptions, projectTotals } from "../src/web/lib/projects.table.ts";
import { parseTableQuery } from "../src/web/lib/table.query.ts";
import { runClientTable } from "../src/web/lib/table.client.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const live = (id: string, used: number, min: number, model = "claude-opus-4-7"): LiveSession => ({
  id, title: id, project_cwd: "/w/acme/web", model, last_ts: ago(min), context_used: used, context_window: 200, context_left_pct: 100 - used / 2, cost_usd: used,
});
const proj = (project: string, cost: number, min: number, over: Partial<ProjectRow> = {}): ProjectRow => ({
  project, path_display: project, name: project.split("/").pop()!, parent: project.slice(0, project.lastIndexOf("/")), kind: "project", repo: null, sessions: 2, last_ts: ago(min), requests: 10, input: 10, output: 5, cache_read: 80, cache_write: 10, cost_usd: cost, unpriced: 0, ...over,
});

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

test("worktrees with a known repo group under the repo's folder, others under their parent", () => {
  expect(folderOf(proj("~/w/acme/web/.claude/worktrees/t1", 1, 1, { kind: "worktree", repo: "~/w/acme/web" }))).toBe("~/w/acme");
  expect(folderOf(proj("~/.codex/worktrees/t1", 1, 1, { kind: "worktree", parent: "~/.codex/worktrees" }))).toBe("~/.codex/worktrees");
  expect(folderOf(proj("~/w/acme/api", 1, 1, { parent: "~/w/acme" }))).toBe("~/w/acme");
});

test("groups run by total cost and a bare URL means Folder", () => {
  const rows = [proj("~/a/x", 5, 1, { parent: "~/a" }), proj("~/b/y", 4, 1, { parent: "~/b" }), proj("~/b/z", 3, 1, { parent: "~/b" })];
  expect(orderGroups(rows, (r) => r.parent).map((r) => r.project)).toEqual(["~/b/y", "~/b/z", "~/a/x"]); // b totals 7 > a 5
  const g = (qs: string) => groupFromUrl(parseTableQuery(new URLSearchParams(qs), PROJECTS_SPEC).group);
  expect([g(""), g("group=kind"), g("group=flat"), g("group=bogus")]).toEqual(["folder", "kind", "none", "folder"]);
  expect(["folder", "kind", "none"].map(groupToUrl).map((u) => groupFromUrl(u))).toEqual(["folder", "kind", "none"]);
});

test("folder grouping gives non-project kinds named buckets, never a literal parent", () => {
  const wt = proj("~/w/acme/web/.claude/worktrees/t1", 1, 1, { kind: "worktree", repo: "~/w/acme/web", parent: "~/w/acme/web/.claude/worktrees" });
  const home = proj("~", 1, 1, { kind: "home", parent: "/Users", name: "~" });
  const temp = proj("/var/T/x", 1, 1, { kind: "temp", parent: "/var/T" });
  const other = proj("/opt/svc", 1, 1, { kind: "other", parent: "/opt" });
  const b = (r: ProjectRow) => { const x = bucketOf(r); return [x.key, x.label]; };
  expect(b(proj("~/w/acme/api", 1, 1, { parent: "~/w/acme" }))).toEqual(["~/w/acme", "~/w/acme"]);
  expect(b(wt)).toEqual(["~/w/acme", "~/w/acme"]);
  expect(b(other)).toEqual(["other", "Outside home"]);
  expect(b(temp)).toEqual(["temp", "Temporary directories"]);
  expect(b(home)).toEqual(["home", "Home directory (~)"]);
  for (const r of [home, temp, other]) expect([r.parent, folderOf(r)]).not.toContain(bucketOf(r).key);
  expect(bucketOf(temp).key).toBe(bucketOf({ ...temp, parent: "/var/other/T" }).key); // one temp bucket
  const rows = [home, temp, other, proj("~/a/x", 1, 1, { parent: "~/a" }), proj("~/b/y", 9, 1, { parent: "~/b" })];
  expect(orderBuckets(rows).map((r) => r.project)).toEqual(["~/b/y", "~/a/x", "/opt/svc", "/var/T/x", "~"]);
});

test("kind facet filters and search matches name and display path", () => {
  const rows = [proj("~/a/web", 1, 1), proj("/var/T", 1, 1, { kind: "temp", name: "T" })];
  const o = projectTableOptions(NOW);
  const r = runClientTable(rows, parseTableQuery(new URLSearchParams("kind=temp&kind=bogus"), PROJECTS_SPEC), o);
  expect(r.filtered.map((x) => x.name)).toEqual(["T"]);
  expect([...r.counts.kind!]).toEqual([["project", 1], ["temp", 1]]);
  expect(runClientTable(rows, parseTableQuery(new URLSearchParams("q=~/a"), PROJECTS_SPEC), o).total).toBe(1);
});

test("projects default to cost desc, search matches the full path, status facet applies", () => {
  const rows = [proj("/w/acme/web", 5, 2), proj("/w/acme/api", 9, 60), proj("/w/zed/cli", 1, 10)];
  const o = projectTableOptions(NOW);
  const d = parseTableQuery(new URLSearchParams(), PROJECTS_SPEC);
  expect(runClientTable(rows, d, o).filtered.map((r) => r.cost_usd)).toEqual([9, 5, 1]);
  expect(runClientTable(rows, parseTableQuery(new URLSearchParams("q=/w/zed"), PROJECTS_SPEC), o).total).toBe(1);
  expect(runClientTable(rows, parseTableQuery(new URLSearchParams("status=live"), PROJECTS_SPEC), o).filtered).toHaveLength(1);
});

test("projectTotals sums usage and picks the latest activity", () => {
  const t = projectTotals([proj("/a/b", 2, 30), proj("/a/c", 3, 5)]);
  expect(t).toMatchObject({ sessions: 4, requests: 20, tokens: 210, cost: 5 });
  expect(t.last).toBe(ago(5));
  expect(t.cache).toBeCloseTo(160 / 200);
});
