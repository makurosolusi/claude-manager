import { expect, test } from "bun:test";
import type { AgentRow } from "../src/server/agents.types.ts";
import { AGENTS_SPEC, agentGroupKey, agentTableOptions, chainText, orderByGroup, scopeKey, tierKey } from "../src/web/lib/agents.table.ts";
import { runClientTable, type ClientTableState } from "../src/web/lib/table.client.ts";

const usage = { requests: 0, cost_usd: 0, unpriced: 0, last_ts: null, rerouted_pct: null };
const mk = (o: Partial<AgentRow> & { name: string }): AgentRow => ({
  kind: "preset", source: null, status: "enabled", description: null, color: null, tier: "work", pin: null,
  alias: "sonnet", model_id: "claude-sonnet-5-5", tools: null, disallowed_tools: null, scopes: [], main_agent: false, usage, ...o,
});
const rows: AgentRow[] = [
  mk({ name: "coder", description: "Writes code", tools: ["Read", "Edit"], scopes: [{ scope: "user", path: "/u", state: "installed" }] }),
  mk({ name: "ui-ux", kind: "custom", tier: null, pin: "fable", alias: "fable", model_id: "fable", scopes: [{ scope: "user", path: "/u", state: "installed" }, { scope: "project", path: "/p", state: "edited" }] }),
  mk({ name: "reviewer", tier: "think", alias: "opus", model_id: "claude-opus-5-5", status: "disabled" }),
  mk({ name: "Explore", kind: "external", source: "builtin", tier: null, alias: "haiku", model_id: null, tools: ["Grep", "Glob"] }),
  mk({ name: "plain", kind: "external", source: "file", tier: null, alias: null, model_id: null }),
];
const base: ClientTableState = { q: "", sort: "name", dir: "asc", page: 1, size: 50, filters: {} };
const run = (s: Partial<ClientTableState>) => runClientTable(rows, { ...base, ...s }, agentTableOptions);
const names = (rs: AgentRow[]) => rs.map((r) => r.name);

test("search matches name, description and tools", () => {
  expect(names(run({ q: "code" }).filtered)).toEqual(["coder"]);
  expect(names(run({ q: "writes" }).filtered)).toEqual(["coder"]);
  expect(names(run({ q: "grep" }).filtered)).toEqual(["Explore"]);
  expect(run({ q: "zzz" }).total).toBe(0);
});

test("facet counts per kind, tier, scope and status", () => {
  const { counts } = run({});
  expect(Object.fromEntries(counts.kind!)).toEqual({ preset: 2, custom: 1, external: 2 });
  expect(Object.fromEntries(counts.tier!)).toEqual({ work: 1, pinned: 1, think: 1, none: 2 });
  expect(Object.fromEntries(counts.scope!)).toEqual({ user: 1, both: 1, none: 3 });
  expect(Object.fromEntries(counts.status!)).toEqual({ enabled: 4, disabled: 1 });
});

test("facet filter ANDs across facets and Pinned selects pinned agents", () => {
  expect(names(run({ filters: { tier: ["pinned"] } }).filtered)).toEqual(["ui-ux"]);
  expect(names(run({ filters: { kind: ["external"], status: ["enabled"] } }).filtered)).toEqual(["Explore", "plain"]);
});

test("keys: tier, scope and group", () => {
  expect(tierKey(rows[1]!)).toBe("pinned");
  expect(tierKey(rows[3]!)).toBe("none");
  expect(scopeKey(rows[1]!)).toBe("both");
  expect(scopeKey(rows[2]!)).toBe("none");
  expect(agentGroupKey("kind", rows[1]!)).toBe("custom");
  expect(agentGroupKey("tier", rows[2]!)).toBe("think");
  expect(agentGroupKey("scope", rows[0]!)).toBe("user");
  expect(agentGroupKey("none", rows[0]!)).toBe("all");
  expect(AGENTS_SPEC.groups).toEqual(["kind", "tier", "scope", "none"]);
});

test("sort by cost descending", () => {
  const withCost = [mk({ name: "a", usage: { ...usage, cost_usd: 1 } }), mk({ name: "b", usage: { ...usage, cost_usd: 3 } })];
  const r = runClientTable(withCost, { ...base, sort: "cost", dir: "desc" }, agentTableOptions);
  expect(names(r.page)).toEqual(["b", "a"]);
});

test("chainText for tier-routed, pinned and external rows", () => {
  expect(chainText(rows[0]!)).toBe("coder → work → sonnet → claude-sonnet-5-5");
  expect(chainText(rows[1]!)).toBe("ui-ux → pinned → fable");
  expect(chainText(mk({ name: "x", tier: null, pin: "claude-haiku-4-5", alias: "claude-haiku-4-5", model_id: "claude-haiku-4-5" }))).toBe("x → pinned → claude-haiku-4-5");
  expect(chainText(rows[3]!)).toBe("Explore → haiku");
  expect(chainText(rows[4]!)).toBe("plain → inherit");
  expect(chainText({ tier: "think", pin: null, alias: "opus", model_id: "claude-opus-5-5" })).toBe("think → opus → claude-opus-5-5");
});

test("orderByGroup ranks groups explicitly and keeps the row order inside a group", () => {
  const keys = (g: string) => [...new Set(orderByGroup(rows, g).map((r) => agentGroupKey(g, r)))];
  expect(keys("kind")).toEqual(["preset", "custom", "external"]);
  expect(keys("tier")).toEqual(["think", "work", "pinned", "none"]);
  expect(keys("scope")).toEqual(["user", "both", "none"]);
  expect(names(orderByGroup(rows, "kind")).slice(-2)).toEqual(["Explore", "plain"]);
  expect(orderByGroup(rows, "all")).toBe(rows);
});
