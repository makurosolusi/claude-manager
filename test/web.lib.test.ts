import { expect, test } from "bun:test";
import type { AgentNode } from "../src/server/dashboard.types.ts";
import { flattenAgentTree } from "../src/web/lib/agent.tree.ts";
import { fmtTime, fmtTokens, fmtUsd, shortPath } from "../src/web/lib/format.ts";
import { hashHref, parseHash } from "../src/web/lib/hash.route.ts";
import { sinceFor } from "../src/web/lib/range.ts";

const agent = (id: string, parent: string | null): AgentNode => ({
  id, parent_agent_id: parent, agent_type: null, description: null, spawn_depth: null, first_ts: null, models: [],
  requests: 0, input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: 0, unpriced: 0,
});

test("flattenAgentTree orders depth-first and survives orphans and cycles", () => {
  const rows = flattenAgentTree([agent("c", "b"), agent("a", null), agent("b", "a"), agent("orphan", "gone"), agent("x", "y"), agent("y", "x")]);
  expect(rows.map((r) => `${r.agent.id}:${r.depth}`)).toEqual(["a:0", "b:1", "c:2", "orphan:0", "x:0", "y:0"]);
});

test("formatters", () => {
  expect(fmtTokens(1_234_567)).toBe("1.2M");
  expect(fmtUsd(12.345)).toBe("$12.35");
  expect(fmtUsd(0.0042)).toBe("$0.0042");
  expect(fmtUsd(0)).toBe("$0.00");
  expect(fmtTime(null)).toBe("—");
  expect(fmtTime("not a date")).toBe("—");
  expect(shortPath("/Users/me/code/app/")).toBe("app");
  expect(shortPath(null)).toBe("—");
});

test("sinceFor converts ranges to ISO bounds", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  expect(sinceFor("24h", now)).toBe("2026-11-26T12:00:00.000Z");
  expect(sinceFor("7d", now)).toBe("2026-11-20T12:00:00.000Z");
  expect(sinceFor("all", now)).toBe("1970-01-01T00:00:00.000Z");
});

test("hash routes round-trip paths and params", () => {
  const href = hashHref("/sessions", { project: "/a b&c", empty: "" });
  expect(href).toBe("#/sessions?project=%2Fa+b%26c");
  const r = parseHash(href);
  expect(r.path).toBe("/sessions");
  expect(r.params.get("project")).toBe("/a b&c");
  expect(parseHash("").path).toBe("/");
});
