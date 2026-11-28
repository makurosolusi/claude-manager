import { expect, test } from "bun:test";
import type { AgentNode } from "../src/server/dashboard.types.ts";
import { byRole, sessionAgentOptions } from "../src/web/lib/session.agents.ts";
import { parseTab, tabForKey, tabHref } from "../src/web/lib/session.tabs.ts";
import { parseHash } from "../src/web/lib/hash.route.ts";
import { runClientTable } from "../src/web/lib/table.client.ts";
import { SESSION_AGENTS_SPEC } from "../src/web/lib/session.agents.ts";
import { parseTableQuery } from "../src/web/lib/table.query.ts";

const node = (id: string, type: string | null, cost: number, first_ts: string | null = null): AgentNode => ({
  id, parent_agent_id: null, agent_type: type, description: `task ${id}`, spawn_depth: 1, first_ts, models: ["claude-sonnet-5-5"],
  requests: 2, input: 1, output: 1, cache_read: 1, cache_write: 1, cost_usd: cost, unpriced: 0,
});

test("parseTab falls back to requests for unknown values", () => {
  expect(parseTab("agents")).toBe("agents");
  expect(parseTab("nope")).toBe("requests");
  expect(parseTab(null)).toBe("requests");
});

test("tabHref drops table params, keeps range, and omits the default tab", () => {
  const route = parseHash("#/sessions/s1?tab=agents&q=x&page=3&range=7d");
  expect(tabHref(route, "prompts")).toBe("#/sessions/s1?range=7d&tab=prompts");
  expect(tabHref(route, "requests")).toBe("#/sessions/s1?range=7d");
});

test("tabForKey wraps and supports Home/End", () => {
  expect(tabForKey("prompts", "ArrowRight")).toBe("requests");
  expect(tabForKey("requests", "ArrowLeft")).toBe("prompts");
  expect(tabForKey("agents", "Home")).toBe("requests");
  expect(tabForKey("agents", "End")).toBe("prompts");
  expect(tabForKey("agents", "a")).toBeNull();
});

test("byRole sums runs per role, costliest first, untyped runs become subagent", () => {
  const rows = byRole([node("a", "coder", 1), node("b", "coder", 2), node("c", null, 5), node("d", "reviewer", 0.5)]);
  expect(rows.map((r) => r.role)).toEqual(["subagent", "coder", "reviewer"]);
  expect(rows[1]).toMatchObject({ runs: 2, requests: 4, cost_usd: 3 });
});

test("agents table: role facet, search and start-time sort", () => {
  const agents = [node("b", "coder", 1, "2026-01-02T00:00:00Z"), node("a", "reviewer", 1, "2026-01-01T00:00:00Z"), node("c", "coder", 1, "2026-01-03T00:00:00Z")];
  const state = { ...parseTableQuery(new URLSearchParams("role=coder"), SESSION_AGENTS_SPEC), size: 25 };
  const r = runClientTable(agents, state, sessionAgentOptions);
  expect(r.page.map((a) => a.id)).toEqual(["b", "c"]);
  expect(r.counts.role!.get("reviewer")).toBe(1);
  expect(runClientTable(agents, { ...state, filters: {}, q: "task a" }, sessionAgentOptions).total).toBe(1);
});
