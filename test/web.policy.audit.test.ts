import { expect, test } from "bun:test";
import { AUDIT_SPEC, auditApi, auditCountLabel, auditFacet, auditHref } from "../src/web/lib/policy.audit.query.ts";
import { parseTableQuery } from "../src/web/lib/table.query.ts";

const state = (qs: string) => parseTableQuery(new URLSearchParams(qs), AUDIT_SPEC);

test("auditApi maps table state to size/page and repeatable facets", () => {
  const { path, query } = auditApi("2026-11-01T00:00:00.000Z", state("q=bash&decision=deny&decision=ask&role=coder&page=2&size=25"), "7d");
  expect(path).toBe("/api/policy/audit");
  expect(query).toMatchObject({ since: "2026-11-01T00:00:00.000Z", q: "bash", page: 2, size: 25, decision: ["deny", "ask"], role: ["coder"], tool: [], cap: [] });
  expect(query).not.toHaveProperty("pageSize");
});

test("cap is a repeatable facet read from the capability counts", () => {
  expect(state("cap=shell&cap=edit").filters.cap).toEqual(["shell", "edit"]);
  expect(auditApi("s", state("cap=shell"), "7d").query).toMatchObject({ cap: ["shell"] });
  const data = { facets: { decision: [], role: [], capability: [{ value: "shell", count: 2 }], tool: [] } } as never;
  expect(auditFacet(data, "cap")).toEqual([{ value: "shell", count: 2 }]);
});

test("unknown decision values are dropped from the URL state", () => {
  expect(state("decision=maybe&decision=allow").filters.decision).toEqual(["allow"]);
});

test("auditHref leaves defaults out and round-trips filters", () => {
  expect(auditHref(state(""), "30d")).toBe("#/policy/audit");
  const href = auditHref(state("decision=deny&page=3"), "24h");
  expect(href).toContain("range=24h");
  expect(href).toContain("decision=deny");
  expect(href).toContain("page=3");
});

test("auditFacet reads server counts; auditCountLabel hides stale totals on error", () => {
  const data = { facets: { decision: [{ value: "deny", count: 4 }], role: [], capability: [], tool: [] } } as never;
  expect(auditFacet(data, "decision")).toEqual([{ value: "deny", count: 4 }]);
  expect(auditFacet(undefined, "tool")).toEqual([]);
  expect(auditCountLabel(12, true)).toBe("—");
  expect(auditCountLabel(undefined, false)).toBe("Loading…");
  expect(auditCountLabel(1, false)).toBe("1 decision");
});
