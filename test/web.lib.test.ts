import { expect, test } from "bun:test";
import type { AgentNode } from "../src/server/dashboard.types.ts";
import { getJson } from "../src/web/lib/api.client.ts";
import { flattenAgentTree } from "../src/web/lib/agent.tree.ts";
import { fmtTime, fmtTokens, fmtUsd } from "../src/web/lib/format.ts";
import { hashHref, parseHash, withParams } from "../src/web/lib/hash.route.ts";
import { META_POLL_FALLBACK_MS, trackVersion, withPollError } from "../src/web/lib/sync.meta.ts";
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

test("withParams keeps path and other params, removes empty keys", () => {
  const route = parseHash("#/sessions?q=api&range=7d&page=3");
  expect(withParams(route, { range: "90d", page: undefined })).toBe("#/sessions?q=api&range=90d");
  expect(withParams(route, { range: undefined, q: "", page: undefined })).toBe("#/sessions");
  expect(route.params.get("page")).toBe("3"); // input not mutated
});

test("trackVersion sets a baseline, then bumps only when changed_at moves", () => {
  let t = trackVersion({ seen: false, changedAt: null, version: 0 }, "2026-11-27T10:00:00Z");
  expect(t.version).toBe(0);
  t = trackVersion(t, "2026-11-27T10:00:00Z");
  expect(t.version).toBe(0);
  t = trackVersion(t, "2026-11-27T10:05:00Z");
  expect(t.version).toBe(1);
  t = trackVersion(t, null);
  expect(t.version).toBe(2);
});

test("withPollError surfaces a failed poll even without prior meta", () => {
  const meta = { synced_at: "2026-11-27T10:00:00Z", changed_at: null, error: null, interval_ms: 2000 };
  expect(withPollError(meta, undefined)).toBe(meta);
  expect(withPollError(meta, new Error("GET /api/meta failed (500): boom"))).toEqual({ ...meta, error: "GET /api/meta failed (500): boom" });
  expect(withPollError(undefined, new Error("x"))).toEqual({ synced_at: null, changed_at: null, interval_ms: META_POLL_FALLBACK_MS, error: "x" });
});

test("getJson names the endpoint on network failure and keeps the cause", async () => {
  const real = globalThis.fetch;
  const cause = new TypeError("Failed to fetch");
  globalThis.fetch = (() => Promise.reject(cause)) as unknown as typeof fetch; // test-only
  try {
    const err = (await getJson("/api/sessions", { page: 1 }).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("GET /api/sessions failed: network error (Failed to fetch)");
    expect(err.cause).toBe(cause);
  } finally {
    globalThis.fetch = real;
  }
});
