import { expect, test } from "bun:test";
import type { AgentNode } from "../src/server/dashboard.types.ts";
import { flattenAgentTree } from "../src/web/lib/agent.tree.ts";
import { fmtClock, fmtSpan, splitTools } from "../src/web/lib/detail.format.ts";
import { REQUEST_SPEC, requestsPath } from "../src/web/lib/requests.query.ts";
import { parseTableQuery, tableParams } from "../src/web/lib/table.query.ts";

const agent = (id: string, parent: string | null, cost: number): AgentNode => ({
  id, parent_agent_id: parent, agent_type: null, description: null, spawn_depth: null, first_ts: null, models: [],
  requests: 0, input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: cost, unpriced: 0,
});

test("flattenAgentTree orders siblings by cost desc and keeps children under their parent", () => {
  const rows = flattenAgentTree([agent("cheap", null, 1), agent("kid", "rich", 5), agent("rich", null, 9), agent("kid2", "rich", 7)]);
  expect(rows.map((r) => `${r.agent.id}:${r.depth}`)).toEqual(["rich:0", "kid2:1", "kid:1", "cheap:0"]);
});

test("fmtClock is local HH:mm:ss and dashes invalid input", () => {
  expect(fmtClock(new Date(2026, 10, 26, 4, 2, 7).toISOString())).toBe("04:02:07");
  expect(fmtClock("nope")).toBe("—");
  expect(fmtClock(null)).toBe("—");
});

test("fmtSpan is the first-to-last duration", () => {
  expect(fmtSpan("2026-11-26T14:00:00Z", "2026-11-26T14:42:30Z")).toBe("42m");
  expect(fmtSpan("2026-11-26T14:00:00Z", null)).toBe("—");
});

test("splitTools keeps 3 icons and counts the overflow", () => {
  expect(splitTools(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], rest: ["d", "e"] });
  expect(splitTools(["a"])).toEqual({ shown: ["a"], rest: [] });
});

test("requestsPath encodes the id and targets the groups endpoint", () => {
  expect(requestsPath("a/b")).toBe("/api/sessions/a%2Fb/requests");
  expect(requestsPath("s1", true)).toBe("/api/sessions/s1/requests/groups");
});

test("REQUEST_SPEC round-trips table state and drops unknown values", () => {
  const params = new URLSearchParams("sort=cost&group=stop&family=opus&family=bogus&agent=coder&page=3");
  const s = parseTableQuery(params, REQUEST_SPEC);
  expect(s).toMatchObject({ sort: "cost", group: "stop", page: 3, filters: { family: ["opus"], agent: ["coder"], stop: [], tool: [] } });
  expect(parseTableQuery(new URLSearchParams("group=bogus&sort=x"), REQUEST_SPEC)).toMatchObject({ sort: "ts", dir: "desc", group: "none" });
  expect(tableParams(s, REQUEST_SPEC)).toMatchObject({ sort: "cost", group: "stop", family: ["opus"], page: "3" });
});
