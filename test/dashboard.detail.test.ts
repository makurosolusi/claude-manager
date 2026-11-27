import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db/db.schema.ts";
import { routeSessionDetail } from "../src/server/session.detail.api.ts";
import type { RequestGroups, RequestRow, RequestsResponse, SessionDetailFull } from "../src/server/session.detail.types.ts";
import { useTempHome } from "./test.home.ts";

useTempHome(); // openDb() resolves under the temp HOME, never ~/.claude
// test-only fixture: one session "s1" with 6 requests (ts/cost/context chosen so every sort key orders differently), one empty session.
const SID = "s1";
type Req = { id: string; ts: string; model: string; agent: string | null; cost: number | null; input: number; read: number; out: number; stop: string | null; tools: string[] };
const REQS: Req[] = [
  { id: "m1", ts: "2026-01-01T00:00:01Z", model: "claude-opus-5", agent: null, cost: 5, input: 100, read: 0, out: 10, stop: "end_turn", tools: ["Bash", "Read"] },
  { id: "m2", ts: "2026-01-01T00:00:02Z", model: "claude-opus-5", agent: null, cost: 1, input: 50, read: 5000, out: 500, stop: "tool_use", tools: ["Bash"] },
  { id: "m3", ts: "2026-01-01T00:00:03Z", model: "claude-sonnet-5", agent: "ag1", cost: 3, input: 900, read: 0, out: 20, stop: "end_turn", tools: [] },
  { id: "m4", ts: "2026-01-01T00:00:04Z", model: "claude-haiku-4-5", agent: "ag1", cost: 2, input: 10, read: 100, out: 5, stop: null, tools: ["Read"] },
  { id: "m5", ts: "2026-01-01T00:00:05Z", model: "mystery-model", agent: null, cost: null, input: 20, read: 0, out: 1, stop: null, tools: [] },
  { id: "m6", ts: "2026-01-01T00:00:06Z", model: "claude-opus-5", agent: null, cost: 3, input: 40, read: 200, out: 30, stop: "end_turn", tools: ["Edit"] },
];
let db: Database;

beforeEach(() => {
  db = openDb();
  db.run("INSERT INTO sessions (id, project_cwd, main_agent, first_ts, last_ts) VALUES ('s1', '/work/app', NULL, '2026-01-01T00:00:01Z', '2026-01-01T00:00:06Z')");
  db.run("INSERT INTO sessions (id, project_cwd, first_ts, last_ts) VALUES ('empty', '/work/app', '2026-01-01T00:00:01Z', '2026-01-01T00:00:01Z')");
  db.run("INSERT INTO agents (id, session_id, agent_type, tool_use_id, spawn_depth) VALUES ('ag1', 's1', 'coder', 'tu0', 1)");
  db.run("INSERT INTO compactions (uuid, session_id, ts, trigger) VALUES ('c1', 's1', '2026-01-01T00:00:05Z', 'auto')");
  for (const r of REQS) {
    db.run(
      `INSERT INTO requests (message_id, session_id, agent_id, ts, model, input, cache_5m, cache_1h, cache_read, output, thinking, web_search,
        cost_usd, pricing_version, stop_reason, is_sidechain) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, ?, 'test', ?, 0)`,
      [r.id, SID, r.agent, r.ts, r.model, r.input, r.read, r.out, r.cost, r.stop],
    );
    r.tools.forEach((t, i) =>
      db.run("INSERT INTO tool_calls (tool_use_id, message_id, session_id, agent_id, ts, name) VALUES (?, ?, ?, ?, ?, ?)", [`${r.id}-${i}`, r.id, SID, r.agent, r.ts, t]),
    );
  }
});
afterEach(() => db.close());

function call(path: string): Response {
  const url = new URL(`http://127.0.0.1:5757${path}`);
  const res = routeSessionDetail(db, url.pathname, url);
  if (!res) throw new Error(`router returned undefined for ${path}`);
  return res;
}
async function get<T>(path: string): Promise<T> {
  const res = call(path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}
const ids = (r: RequestsResponse) => r.items.map((i) => i.message_id);
const list = (q: string) => get<RequestsResponse>(`/api/sessions/${SID}/requests?${q}`);

describe("session detail", () => {
  test("extends the detail with models, tools, compactions and context", async () => {
    const d = await get<SessionDetailFull>(`/api/sessions/${SID}`);
    expect(d.session.id).toBe(SID);
    expect(d.agents.map((a) => a.id)).toEqual(["ag1"]);
    expect(d.models.find((m) => m.key === "claude-opus-5")).toMatchObject({ requests: 3, cost_usd: 9 });
    expect(d.tools).toEqual([{ name: "Bash", calls: 2 }, { name: "Read", calls: 2 }, { name: "Edit", calls: 1 }]);
    expect(d.compactions).toBe(1);
    // latest main-agent request is m6 (input 40 + read 200) on a 1M-window model
    expect(d.context).toEqual({ used: 240, window: 1_000_000 });
  });

  test("context is null without main-agent requests", async () => {
    expect((await get<SessionDetailFull>("/api/sessions/empty")).context).toBeNull();
  });

  test("requests default to newest first with tools per row", async () => {
    const r = await list("");
    expect(ids(r)).toEqual(["m6", "m5", "m4", "m3", "m2", "m1"]);
    expect(r.total).toBe(6);
    expect(r.facets).toBeUndefined();
    const m1 = r.items.find((i) => i.message_id === "m1") as RequestRow;
    expect(m1.tools.sort()).toEqual(["Bash", "Read"]);
    expect(m1).toMatchObject({ role: "main", context: 100, stop_reason: "end_turn" });
    expect(r.items.find((i) => i.message_id === "m3")).toMatchObject({ role: "coder", tools: [] });
  });

  test("sorts by each key in both directions", async () => {
    expect(ids(await list("sort=ts&dir=asc"))).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    // cost: m5 unpriced counts as 0
    expect(ids(await list("sort=cost&dir=desc"))).toEqual(["m1", "m3", "m6", "m4", "m2", "m5"]); // m3 and m6 tie at 3 -> message_id
    expect(ids(await list("sort=cost&dir=asc"))).toEqual(["m5", "m2", "m4", "m3", "m6", "m1"]);
    // tokens = input + output + cache_read + cache_write
    expect(ids(await list("sort=tokens&dir=desc"))).toEqual(["m2", "m3", "m6", "m4", "m1", "m5"]);
    expect(ids(await list("sort=context&dir=desc"))).toEqual(["m2", "m3", "m6", "m4", "m1", "m5"]);
  });

  test("ties break on message_id and pages do not overlap", async () => {
    const tied = (await list("sort=cost&dir=desc")).items.filter((i) => i.cost_usd === 3).map((i) => i.message_id);
    expect(tied).toEqual(["m3", "m6"]);
    const p1 = await list("sort=cost&dir=desc&pageSize=4&page=1");
    const p2 = await list("sort=cost&dir=desc&pageSize=4&page=2");
    expect([...ids(p1), ...ids(p2)]).toEqual(["m1", "m3", "m6", "m4", "m2", "m5"]);
    expect(p2).toMatchObject({ page: 2, pageSize: 4, total: 6 });
  });

  test("filters by family, agent, stop (including none) and tool via EXISTS", async () => {
    expect(ids(await list("family=opus&sort=ts&dir=asc"))).toEqual(["m1", "m2", "m6"]);
    expect(ids(await list("family=sonnet&family=haiku&sort=ts&dir=asc"))).toEqual(["m3", "m4"]);
    expect(ids(await list("family=other"))).toEqual(["m5"]);
    expect(ids(await list("agent=coder&sort=ts&dir=asc"))).toEqual(["m3", "m4"]);
    expect(ids(await list("agent=main&sort=ts&dir=asc"))).toEqual(["m1", "m2", "m5", "m6"]);
    expect(ids(await list("stop=none&sort=ts&dir=asc"))).toEqual(["m4", "m5"]);
    expect(ids(await list("stop=none&stop=tool_use&sort=ts&dir=asc"))).toEqual(["m2", "m4", "m5"]);
    // m1 calls two tools: Bash + Read filter must still return it once
    const t = await list("tool=Bash&tool=Read&sort=ts&dir=asc");
    expect(ids(t)).toEqual(["m1", "m2", "m4"]);
    expect(t.total).toBe(3);
    expect(ids(await list("family=opus&tool=Read&stop=end_turn"))).toEqual(["m1"]);
  });

  test("facet counts ignore their own filter but honour the others", async () => {
    const all = (await list("facets=1")).facets!;
    expect(all.family).toEqual([{ value: "opus", count: 3 }, { value: "haiku", count: 1 }, { value: "other", count: 1 }, { value: "sonnet", count: 1 }]);
    expect(all.tool).toContainEqual({ value: "Bash", count: 2 });
    // family=opus: family facet still counts every family, other facets narrow to opus
    const f = (await list("facets=1&family=opus")).facets!;
    expect(f.family).toEqual(all.family);
    expect(f.agent).toEqual([{ value: "main", count: 3 }]);
    expect(f.stop.map((s) => s.value).sort()).toEqual(["end_turn", "tool_use"]);
    expect(f.tool.sort((a, b) => a.value.localeCompare(b.value))).toEqual([
      { value: "Bash", count: 2 }, { value: "Edit", count: 1 }, { value: "Read", count: 1 },
    ]);
    // stop=none: stop facet keeps all values, tool facet narrows to m4's Read
    const s = (await list("facets=1&stop=none")).facets!;
    expect(s.stop).toEqual(all.stop);
    expect(s.tool).toEqual([{ value: "Read", count: 1 }]);
  });

  test("groups sum to the filtered total and cost", async () => {
    const everything = await list("pageSize=200");
    const totalCost = everything.items.reduce((n, r) => n + r.cost_usd, 0);
    for (const by of ["agent", "family", "stop"] as const) {
      const g = await get<RequestGroups>(`/api/sessions/${SID}/requests/groups?by=${by}`);
      expect(g.by).toBe(by);
      expect(g.groups.reduce((n, x) => n + x.count, 0)).toBe(everything.total);
      expect(g.groups.reduce((n, x) => n + x.cost_usd, 0)).toBeCloseTo(totalCost, 9);
      expect(g.total_groups).toBe(g.groups.length);
    }
    const byAgent = await get<RequestGroups>(`/api/sessions/${SID}/requests/groups?by=agent`);
    expect(byAgent.groups[0]).toMatchObject({ key: "main", count: 4, cost_usd: 9, unpriced: 1 });
    const stop = await get<RequestGroups>(`/api/sessions/${SID}/requests/groups?by=stop`);
    expect(stop.groups.map((x) => x.key).sort()).toEqual(["end_turn", "none", "tool_use"]);
    // groups share the filter with the list
    const filtered = await get<RequestGroups>(`/api/sessions/${SID}/requests/groups?by=family&agent=main`);
    expect(filtered.groups.reduce((n, x) => n + x.count, 0)).toBe((await list("agent=main")).total);
  });

  test("unknown session is 404 on all three endpoints", async () => {
    for (const p of ["", "/requests", "/requests/groups?by=agent"]) {
      const res = call(`/api/sessions/nope${p}`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe("session not found");
    }
  });

  test("invalid params are rejected with 400", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `tool=t${i}`).join("&");
    const cases: [string, string][] = [
      [`/api/sessions/${SID}/requests?sort=bogus`, 'invalid sort "bogus": use one of ts, cost, tokens, context'],
      [`/api/sessions/${SID}/requests?dir=up`, 'invalid dir "up": use one of asc, desc'],
      [`/api/sessions/${SID}/requests?family=gpt`, 'invalid family "gpt": use one of opus, sonnet, haiku, other'],
      [`/api/sessions/${SID}/requests?pageSize=201`, "invalid pageSize"],
      [`/api/sessions/${SID}/requests?${many}`, "at most 20 values"],
      [`/api/sessions/${SID}/requests?stop=${"x".repeat(513)}`, "at most 512 characters"],
      [`/api/sessions/${SID}/requests/groups?by=model`, 'invalid by "model": use one of agent, family, stop'],
      [`/api/sessions/${SID}/requests/groups`, "invalid by"],
    ];
    for (const [path, msg] of cases) {
      const res = call(path);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(msg);
    }
  });

  test("other paths are left to the main router", () => {
    for (const p of ["/api/sessions", `/api/sessions/${SID}/timeline`, "/api/overview"]) {
      expect(routeSessionDetail(db, p, new URL(`http://127.0.0.1:5757${p}`))).toBeUndefined();
    }
  });
});
