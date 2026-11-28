import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDb } from "../src/db/db.schema.ts";
import { sync } from "../src/ingest/ingest.service.ts";
import { contextWindow, DEFAULT_CONTEXT_WINDOW, LONG_CONTEXT_WINDOW } from "../src/server/context.window.ts";
import { DEFAULT_TIER_MODELS } from "../src/config/config.store.ts";
import { PRESET_ROLES } from "../src/roles/roles.presets.ts";
import { handleApi, overview, SYNC_INTERVAL_MS } from "../src/server/dashboard.api.ts";
import type { DashboardMeta, LiveSession, Overview, Page, ProjectRow, RoleRow, SessionDetail, SessionRow, TimelineItem } from "../src/server/dashboard.types.ts";
import { useTempHome } from "./test.home.ts";

// test-only fixtures: synthetic transcripts shaped like Claude Code's JSONL, never real logs.
const ctx = useTempHome();
const OLD = "aaaaaaaa-0000-0000-0000-000000000001"; // 2h ago, main + nested subagents
const LIVE_200K = "bbbbbbbb-0000-0000-0000-000000000002"; // 1 min ago
const LIVE_1M = "cccccccc-0000-0000-0000-000000000003"; // 5 min ago, once exceeded 200k
const MIN = 60_000;
const BASE = "http://127.0.0.1:5757";

let db: Database;
let now: number;

const log = (cwd: string, sid: string, agent?: string) =>
  join(ctx.claude, "projects", cwd.replaceAll("/", "-"), ...(agent ? [sid, "subagents", `agent-${agent}.jsonl`] : [`${sid}.jsonl`]));

function write(path: string, entries: unknown[], meta?: Record<string, unknown>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
  if (meta) writeFileSync(path.replace(/\.jsonl$/, ".meta.json"), JSON.stringify(meta));
}

let seq = 0;
const at = (sid: string, cwd: string, ts: number, o: Record<string, unknown>) => ({
  sessionId: sid,
  timestamp: new Date(ts).toISOString(),
  uuid: `u-${++seq}`,
  cwd,
  gitBranch: "main",
  version: "2.5.0",
  ...o,
});
const assistant = (id: string, model: string, usage: Record<string, number>, content: unknown[] = []) => ({
  type: "assistant",
  requestId: `req-${id}`,
  message: { id, model, usage, content, stop_reason: "end_turn" },
});
const prompt = (text: string) => ({ type: "user", promptSource: "typed", message: { role: "user", content: text } });
const spawn = (id: string) => ({ type: "tool_use", id, name: "Agent", input: { subagent_type: "coder" } });

beforeEach(async () => {
  now = Date.now();
  const old = now - 120 * MIN;
  const s = (n: number) => old + n * 1000;
  const A = (ts: number, o: Record<string, unknown>) => at(OLD, "/work/app", ts, o);
  write(log("/work/app", OLD), [
    A(s(0), prompt("first")),
    A(s(1), assistant("m1", "claude-opus-5-5", { input_tokens: 1000, output_tokens: 100 }, [spawn("tu_1")])),
    A(s(10), prompt("second")),
    A(s(11), assistant("m2", "claude-opus-5-5", { input_tokens: 2000, output_tokens: 200 })),
    A(s(12), { type: "ai-title", aiTitle: "Fix Stripe Webhook" }),
  ]);
  write(
    log("/work/app", OLD, "aaa"),
    [A(s(2), prompt("subagent task")), A(s(3), assistant("a1", "claude-haiku-4-5", { input_tokens: 500, output_tokens: 50 }, [spawn("tu_2")]))],
    { agentType: "coder", description: "write code", toolUseId: "tu_1", spawnDepth: 1 },
  );
  write(log("/work/app", OLD, "bbb"), [A(s(4), assistant("b1", "claude-sonnet-5-5", { input_tokens: 300, output_tokens: 30 }))], {
    agentType: "reviewer",
    description: "review",
    toolUseId: "tu_2",
    spawnDepth: 2,
  });

  const B = (ts: number, o: Record<string, unknown>) => at(LIVE_200K, "/work/web", ts, o);
  write(log("/work/web", LIVE_200K), [
    B(now - 2 * MIN, prompt("hi")),
    B(now - MIN, assistant("bb1", "claude-haiku-4-5", { input_tokens: 0, cache_read_input_tokens: 150_000, output_tokens: 10 })),
  ]);
  const C = (ts: number, o: Record<string, unknown>) => at(LIVE_1M, "/work/web", ts, o);
  write(log("/work/web", LIVE_1M), [
    C(now - 7 * MIN, prompt("big")),
    C(now - 6 * MIN, assistant("cc1", "claude-haiku-4-5", { input_tokens: 0, cache_read_input_tokens: 250_000, output_tokens: 10 })),
    C(now - 5 * MIN, assistant("cc2", "claude-haiku-4-5", { input_tokens: 0, cache_read_input_tokens: 100_000, output_tokens: 10 })),
  ]);

  db = openDb();
  await sync(db);
});
afterEach(() => db.close());

function call(path: string, init?: RequestInit): Response {
  const res = handleApi(new Request(`${BASE}${path}`, init), db);
  if (!res) throw new Error(`handleApi returned undefined for ${path}`);
  return res;
}
async function get<T>(path: string): Promise<T> {
  const res = call(path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("dashboard api", () => {
  test("overview totals cover every request including subagents", async () => {
    const o = await get<Overview>("/api/overview");
    expect(o.total).toMatchObject({ requests: 7, input: 3800, cache_read: 500_000, output: 410, unpriced: 0 });
    expect(o.total.cost_usd).toBeGreaterThan(0);
    expect(o.byModel.map((r) => r.key).sort()).toEqual(["claude-haiku-4-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(o.byDay.reduce((n, r) => n + r.requests, 0)).toBe(7);
    expect(o.byRole.map((r) => r.key).sort()).toEqual(["coder", "main", "reviewer"]);
  });

  test("project filter narrows the overview", async () => {
    const o = await get<Overview>("/api/overview?project=%2Fwork%2Fweb");
    expect(o.total.requests).toBe(3);
  });

  test("projects are grouped with session counts", async () => {
    const p = await get<Page<ProjectRow>>("/api/projects");
    expect(p.total).toBe(2);
    const byName = Object.fromEntries(p.items.map((r) => [r.project, r]));
    expect(byName["/work/app"]).toMatchObject({ sessions: 1, requests: 4 });
    expect(byName["/work/web"]).toMatchObject({ sessions: 2, requests: 3 });
    expect(byName["/work/app"]).toMatchObject({ path_display: "/work/app", name: "app", parent: "/work", kind: "other", repo: null }); // outside the temp HOME
  });

  test("sessions are paged newest first", async () => {
    const p1 = await get<Page<SessionRow>>("/api/sessions?pageSize=2");
    expect(p1.items.map((s) => s.id)).toEqual([LIVE_200K, LIVE_1M]);
    const p2 = await get<Page<SessionRow>>("/api/sessions?page=2&pageSize=2");
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0]).toMatchObject({ id: OLD, agents: 2, requests: 4, project_cwd: "/work/app" });
  });

  test("invalid paging and since are rejected with 400", async () => {
    for (const q of ["pageSize=201", "pageSize=0", "pageSize=x", "page=0", "page=1.5", "since=garbage"]) {
      const res = call(`/api/sessions?${q}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBeString();
    }
    expect(call("/api/sessions?pageSize=200").status).toBe(200);
  });

  test("session detail lists subagents with their spawning parent", async () => {
    const d = await get<SessionDetail>(`/api/sessions/${OLD}`);
    expect(d.session).toMatchObject({ id: OLD, requests: 4, input: 3800, agents: 2 });
    const byId = Object.fromEntries(d.agents.map((a) => [a.id, a]));
    expect(byId.aaa).toMatchObject({ parent_agent_id: null, agent_type: "coder", spawn_depth: 1, requests: 1, input: 500, models: ["claude-haiku-4-5"] });
    expect(byId.bbb).toMatchObject({ parent_agent_id: "aaa", agent_type: "reviewer", spawn_depth: 2, requests: 1, input: 300 });
  });

  test("unknown session is 404 for detail and timeline", async () => {
    for (const path of ["/api/sessions/nope", "/api/sessions/nope/timeline"]) {
      const res = call(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "session not found" });
    }
  });

  test("timeline buckets every request between consecutive main prompts", async () => {
    const t = await get<Page<TimelineItem>>(`/api/sessions/${OLD}/timeline`);
    expect(t.total).toBe(2);
    const [first, second] = t.items;
    expect(first).toMatchObject({ text: "first", agent_id: null, requests: 3, input: 1800, output: 180 });
    expect(first!.models.sort()).toEqual(["claude-haiku-4-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(second).toMatchObject({ text: "second", requests: 1, input: 2000, models: ["claude-opus-5-5"] });

    const p2 = await get<Page<TimelineItem>>(`/api/sessions/${OLD}/timeline?page=2&pageSize=1`);
    expect(p2.items.map((i) => i.text)).toEqual(["second"]);
    expect(p2.items[0]!.requests).toBe(1);
  });

  test("roles group by role and model", async () => {
    const p = await get<Page<RoleRow>>("/api/roles");
    expect(p.total).toBe(4);
    const rows = Object.fromEntries(p.items.map((r) => [`${r.role}/${r.model}`, r.requests]));
    expect(rows).toEqual({ "main/claude-opus-5-5": 2, "main/claude-haiku-4-5": 3, "coder/claude-haiku-4-5": 1, "reviewer/claude-sonnet-5-5": 1 });
  });

  test("live lists only recent sessions with context left", async () => {
    const live = await get<LiveSession[]>("/api/live");
    expect(live.map((s) => s.id)).toEqual([LIVE_200K, LIVE_1M]);
    expect(live[0]).toMatchObject({ model: "claude-haiku-4-5", context_used: 150_000, context_window: 200_000, context_left_pct: 25 });
    // Last request is 100k, but an earlier 250k prompt proves a 1M window.
    expect(live[1]).toMatchObject({ context_used: 100_000, context_window: 1_000_000, context_left_pct: 90 });
    expect(live[1]!.cost_usd).toBeGreaterThan(0);
  });

  test("foreign Host header is 403", () => {
    expect(call("/api/overview", { headers: { host: "evil.example:5757" } }).status).toBe(403);
    expect(call("/api/overview", { headers: { host: "127.0.0.1:9999" } }).status).toBe(403);
    expect(call("/api/overview", { headers: { host: "localhost:5757" } }).status).toBe(200);
  });

  test("non-GET is 405, unknown endpoint is 404, non-api is passed through", () => {
    expect(call("/api/overview", { method: "POST" }).status).toBe(405);
    expect(call("/api/unknown").status).toBe(404);
    expect(handleApi(new Request(`${BASE}/`), db)).toBeUndefined();
  });
});

describe("dashboard api: overview deltas and charts", () => {
  test("prev is null for all-time and holds the equal-length window before since", async () => {
    expect((await get<Overview>("/api/overview?since=1970-01-01")).prev).toBeNull();
    // Window = last 70 min (both live sessions); prev = the 70 min before it (the 2h-old session).
    const o = overview(db, { since: new Date(now - 70 * MIN).toISOString() }, now);
    expect(o.total).toMatchObject({ requests: 3, sessions: 2 });
    expect(o.prev).toMatchObject({ requests: 4, sessions: 1, input: 3800 });
  });

  test("total counts distinct sessions", async () => {
    expect((await get<Overview>("/api/overview")).total.sessions).toBe(3);
    expect((await get<Overview>("/api/overview?project=%2Fwork%2Fapp")).total.sessions).toBe(1);
  });

  test("byDayModel splits byDay by model without losing cost or requests", async () => {
    const o = await get<Overview>("/api/overview");
    const sum = (rows: { cost_usd: number; requests: number }[]) => rows.reduce((a, r) => ({ cost_usd: a.cost_usd + r.cost_usd, requests: a.requests + r.requests }), { cost_usd: 0, requests: 0 });
    expect(sum(o.byDayModel).cost_usd).toBeCloseTo(sum(o.byDay).cost_usd, 10);
    expect(sum(o.byDayModel).requests).toBe(7);
    expect(new Set(o.byDayModel.map((r) => r.model))).toEqual(new Set(["claude-haiku-4-5", "claude-opus-5-5", "claude-sonnet-5-5"]));
  });
});

describe("dashboard api: session sort, search and model", () => {
  test("sort=cost orders by cost in both directions", async () => {
    const desc = (await get<Page<SessionRow>>("/api/sessions?sort=cost&dir=desc")).items.map((s) => s.cost_usd);
    expect(desc).toHaveLength(3);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    const asc = (await get<Page<SessionRow>>("/api/sessions?sort=cost&dir=asc")).items.map((s) => s.cost_usd);
    expect(asc).toEqual([...desc].reverse());
    const byRequests = await get<Page<SessionRow>>("/api/sessions?sort=requests&pageSize=1");
    expect(byRequests.items.map((s) => s.id)).toEqual([OLD]);
  });

  test("unknown sort or dir and an over-long q are 400", async () => {
    const res = call("/api/sessions?sort=x");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid sort "x": use one of last, cost, requests, tokens, agents');
    expect(call("/api/sessions?dir=up").status).toBe(400);
    expect(call(`/api/sessions?q=${"a".repeat(201)}`).status).toBe(400);
  });

  test("q matches title, id prefix and project path, case-insensitively", async () => {
    const ids = async (q: string) => (await get<Page<SessionRow>>(`/api/sessions?q=${encodeURIComponent(q)}`)).items.map((s) => s.id).sort();
    expect(await ids("stripe webhook")).toEqual([OLD]);
    expect(await ids("bbbbbbbb")).toEqual([LIVE_200K]);
    expect(await ids("/WORK/WEB")).toEqual([LIVE_200K, LIVE_1M]);
    expect(await ids("  ")).toHaveLength(3);
    const p = await get<Page<SessionRow>>("/api/sessions?q=work&project=%2Fwork%2Fapp");
    expect(p).toMatchObject({ total: 1, items: [{ id: OLD }] });
  });

  test("model is the main agent's most-used model; models counts every model", async () => {
    const d = await get<SessionDetail>(`/api/sessions/${OLD}`);
    expect(d.session).toMatchObject({ model: "claude-opus-5-5", models: 3, title: "Fix Stripe Webhook" });
    const row = (await get<Page<SessionRow>>("/api/sessions")).items.find((s) => s.id === LIVE_1M);
    expect(row).toMatchObject({ model: "claude-haiku-4-5", models: 1 });
  });
});

describe("dashboard api: meta", () => {
  test("without a provider reports never synced and the default tiers", async () => {
    expect(await get<DashboardMeta>("/api/meta")).toEqual({ synced_at: null, changed_at: null, error: null, interval_ms: SYNC_INTERVAL_MS, tiers: DEFAULT_TIER_MODELS, roles: PRESET_ROLES.map((r) => ({ name: r.name, tier: r.tier, source: "preset" })) });
  });

  test("returns the provider's sync state and configured tiers", async () => {
    const meta: DashboardMeta = {
      synced_at: "2026-11-27T10:00:00.000Z",
      changed_at: "2026-11-27T09:59:00.000Z",
      error: "disk full",
      interval_ms: 1000,
      tiers: { think: "claude-opus-test", work: "claude-sonnet-test", basic: "claude-haiku-test" }, // test-only
      roles: [{ name: "coder", tier: "work", source: "preset" }, { name: "qa", tier: "basic", source: "custom" }],
    };
    const res = handleApi(new Request(`${BASE}/api/meta`), db, undefined, () => meta)!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(meta);
  });
});

describe("context window", () => {
  test("1M for long-context models, [1m] suffix or an oversized prompt", () => {
    expect(contextWindow("claude-haiku-4-5", 0)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindow("claude-opus-4-5-20251101", 0)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindow("claude-opus-5-5", 0)).toBe(LONG_CONTEXT_WINDOW);
    expect(contextWindow("claude-sonnet-4-6-20260101", 0)).toBe(LONG_CONTEXT_WINDOW);
    expect(contextWindow("claude-sonnet-4-5[1m]", 0)).toBe(LONG_CONTEXT_WINDOW);
    expect(contextWindow("claude-haiku-4-5", DEFAULT_CONTEXT_WINDOW + 1)).toBe(LONG_CONTEXT_WINDOW);
  });
});
