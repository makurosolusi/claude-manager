import { expect, test } from "bun:test";
import { parseHash } from "../src/web/lib/hash.route.ts";
import { SESSIONS_SPEC, sessionsApiPath, sessionsCountLabel, sessionsHref } from "../src/web/lib/sessions.query.ts";
import { parseTableQuery, type TableState } from "../src/web/lib/table.query.ts";

const parse = (qs: string) => parseTableQuery(new URLSearchParams(qs), SESSIONS_SPEC);
const SINCE = "2026-01-01T00:00:00.000Z";
const base = parse("");

test("empty params parse to defaults", () => {
  expect(base).toMatchObject({ q: "", sort: "last", dir: "desc", page: 1, size: 50, group: "none" });
  expect(base.filters).toEqual({ project: [], family: [], role: [], status: [] });
});

test("unknown facet values and groups are dropped", () => {
  const s = parse("family=opus&family=gpt&status=live&group=role&sort=bogus");
  expect(s.filters.family).toEqual(["opus"]);
  expect(s.filters.status).toEqual(["live"]);
  expect(s.group).toBe("none");
  expect(s.sort).toBe("last");
});

test("defaults and the default range are dropped from the href", () => {
  expect(sessionsHref(base, "30d")).toBe("#/sessions");
});

test("state and range round-trip through the href with repeated facet keys", () => {
  const state: TableState = { ...base, q: "api", sort: "cost", dir: "asc", page: 2, size: 25, group: "project", filters: { ...base.filters, family: ["opus", "haiku"], project: ["/w/acme/web"] } };
  const { path, params } = parseHash(sessionsHref(state, "7d"));
  expect(path).toBe("/sessions");
  expect(params.get("range")).toBe("7d");
  expect(params.getAll("family")).toEqual(["opus", "haiku"]);
  expect(parseTableQuery(params, SESSIONS_SPEC)).toEqual(state);
});

test("list path carries filters, sort, paging and facets=1", () => {
  const s = { ...base, q: "x", filters: { ...base.filters, family: ["opus", "haiku"] } };
  const qs = new URL(sessionsApiPath(SINCE, s, { facets: true }), "http://x").searchParams;
  expect(qs.getAll("family")).toEqual(["opus", "haiku"]);
  expect([qs.get("q"), qs.get("sort"), qs.get("page"), qs.get("pageSize"), qs.get("facets")]).toEqual(["x", "last", "1", "50", "1"]);
});

test("groups path has by + filters but no paging or sort", () => {
  const s = { ...base, group: "family", filters: { ...base.filters, status: ["live"] } };
  const u = new URL(sessionsApiPath(SINCE, s, { groups: true }), "http://x");
  expect(u.pathname).toBe("/api/sessions/groups");
  expect(u.searchParams.get("by")).toBe("family");
  expect(u.searchParams.getAll("status")).toEqual(["live"]);
  expect(u.searchParams.has("page") || u.searchParams.has("sort")).toBe(false);
});

test("expanding a group narrows its dimension to that key, page 1, 10 rows", () => {
  const s = { ...base, page: 4, group: "project", filters: { ...base.filters, project: ["/a", "/b"], family: ["opus"] } };
  const qs = new URL(sessionsApiPath(SINCE, s, { only: { by: "project", key: "/b" }, size: 10 }), "http://x").searchParams;
  expect(qs.getAll("project")).toEqual(["/b"]);
  expect(qs.getAll("family")).toEqual(["opus"]);
  expect([qs.get("page"), qs.get("pageSize")]).toEqual(["1", "10"]);
});

test("count label hides a stale total on error", () => {
  expect(sessionsCountLabel(42, true)).toBe("—");
  expect(sessionsCountLabel(undefined, false)).toBe("Loading…");
  expect(sessionsCountLabel(1, false)).toBe("1 session");
  expect(sessionsCountLabel(1234, false)).toBe("1,234 sessions");
});

test("group subtotals carry a token-weighted cache hit", async () => {
  const { groupSpecs } = await import("../src/web/pages/sessions.groups.tsx");
  const g = { key: "/w/a", count: 2, last_ts: null, input: 10, output: 5, cache_read: 980, cache_write: 10, cost_usd: 1, unpriced: 0 };
  const [spec] = groupSpecs([g] as never, { state: { ...base, group: "project" }, since: SINCE, open: [], results: {}, toggle() {}, showAll() {} });
  expect(spec!.totals.cache).toBe("98.0%");
});
