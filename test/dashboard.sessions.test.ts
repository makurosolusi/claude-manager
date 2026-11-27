import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { openDb } from "../src/db/db.schema.ts";
import { sessionsPage } from "../src/db/sessions.repository.ts";
import { FAMILY_SQL, usageTotal } from "../src/db/stats.repository.ts";
import { handleApi } from "../src/server/dashboard.api.ts";
import type { GroupRow, Page, SessionGroups, SessionRow, SessionsResponse } from "../src/server/dashboard.types.ts";
import { modelFamily } from "../src/web/lib/model.tier.ts";
import { useTempHome } from "./test.home.ts";

// test-only: synthetic sessions inserted straight into a temp DB; never real logs.
const ctx = useTempHome();
const MIN = 60_000;
const BASE = "http://127.0.0.1:5757";
const SINCE = "since=1970-01-01";
const EPOCH = "1970-01-01T00:00:00.000Z";

let db: Database;
let now: number;

// id, project, minutes ago, [model, agent_id, cost][]
const FIXTURE: [string, string, number, [string, string | null, number][]][] = [
  ["s1", "acme/web", 1, [["claude-opus-5-5", null, 1], ["claude-opus-5-5", null, 2]]],
  ["s2", "acme/web-old", 10, [["claude-sonnet-5-5", null, 0.5], ["claude-haiku-4-5", "ag1", 0.1]]],
  ["s3", "acme/web", 120, [["claude-haiku-4-5", null, 0.2]]],
  ["s4", "acme/api", 180, [["mystery-model", null, 0.3]]],
];

beforeEach(() => {
  now = Date.now();
  db = openDb(join(ctx.app, "data.db"));
  let n = 0;
  for (const [id, project, ago, reqs] of FIXTURE) {
    const ts = new Date(now - ago * MIN).toISOString();
    db.run("INSERT INTO sessions (id, project_cwd, title, last_ts, first_ts) VALUES (?, ?, ?, ?, ?)", [id, project, `title ${id}`, ts, ts]);
    for (const [model, agent, cost] of reqs) {
      db.run(
        `INSERT INTO requests (message_id, session_id, agent_id, ts, model, input, cache_5m, cache_1h, cache_read, output, thinking, web_search, cost_usd, pricing_version, is_sidechain)
         VALUES (?, ?, ?, ?, ?, 100, 0, 0, 0, 10, 0, 0, ?, 'v', 0)`,
        [`m${++n}`, id, agent, ts, model, cost],
      );
    }
  }
  db.run("INSERT INTO agents (id, session_id, agent_type, spawn_depth) VALUES ('ag1', 's2', 'coder', 1)");
});
afterEach(() => db.close());

const call = (path: string) => handleApi(new Request(`${BASE}${path}`), db)!;
async function get<T>(path: string): Promise<T> {
  const res = call(path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}
const ids = async (qs: string) => (await get<SessionsResponse>(`/api/sessions?${SINCE}&${qs}`)).items.map((s) => s.id).sort();
const cnt = (f: { value: string; count: number }[]) => Object.fromEntries(f.map((x) => [x.value, x.count]));

describe("sessions filters", () => {
  test("project is exact: acme/web does not match acme/web-old", async () => {
    expect(await ids("project=acme%2Fweb")).toEqual(["s1", "s3"]);
    expect(await ids("project=acme%2Fweb&project=acme%2Fapi")).toEqual(["s1", "s3", "s4"]);
  });

  test("CLI-style `project` stays a substring match", () => {
    expect(usageTotal(db, { since: EPOCH, project: "web" }).requests).toBe(5);
    expect(usageTotal(db, { since: EPOCH, projects: ["acme/web"] }).requests).toBe(3);
  });

  test("family filters by the session's primary model", async () => {
    expect(await ids("family=opus")).toEqual(["s1"]);
    expect(await ids("family=haiku&family=other")).toEqual(["s3", "s4"]);
  });

  test("role matches sessions with any request of that role", async () => {
    expect(await ids("role=coder")).toEqual(["s2"]);
    expect(await ids("role=main")).toEqual(["s1", "s2", "s3", "s4"]);
  });

  test("status uses the injected now", () => {
    const page = (n: number, statuses: string[]) => sessionsPage(db, { since: EPOCH, statuses }, { page: 1, pageSize: 10 }, undefined, n).items.map((s) => s.id).sort();
    expect(page(now, ["live"])).toEqual(["s1"]);
    expect(page(now, ["idle"])).toEqual(["s2"]);
    expect(page(now, ["ended"])).toEqual(["s3", "s4"]);
    expect(page(now + 30 * MIN, ["live", "idle"])).toEqual([]);
    expect(page(now + 30 * MIN, ["ended"])).toEqual(["s1", "s2", "s3", "s4"]);
  });

  test("bad values are 400 with the allowed list", async () => {
    for (const [qs, msg] of [
      ["family=gpt", 'invalid family "gpt": use one of opus, sonnet, haiku, fable, other'],
      ["status=dead", 'invalid status "dead": use one of live, idle, ended'],
    ] as const) {
      const res = call(`/api/sessions?${qs}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: msg });
    }
    const by = call("/api/sessions/groups?by=role");
    expect(by.status).toBe(400);
    expect(((await by.json()) as { error: string }).error).toBe('invalid by "role": use one of project, family, status');
    expect(call("/api/sessions/groups").status).toBe(400);
  });

  test("more than 20 values or a value over 512 chars is 400", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `project=p${i}`).join("&");
    expect(call(`/api/sessions?${many}`).status).toBe(400);
    expect(call(`/api/sessions?${many.split("&").slice(0, 20).join("&")}`).status).toBe(200);
    expect(call(`/api/sessions?role=${"x".repeat(513)}`).status).toBe(400);
  });
});

describe("sessions facets", () => {
  test("facets are absent unless facets=1", async () => {
    expect((await get<SessionsResponse>(`/api/sessions?${SINCE}`)).facets).toBeUndefined();
  });

  test("counts apply every filter except their own dimension", async () => {
    const all = (await get<SessionsResponse>(`/api/sessions?${SINCE}&facets=1`)).facets!;
    expect(cnt(all.project)).toEqual({ "acme/web": 2, "acme/web-old": 1, "acme/api": 1 });
    expect(cnt(all.family)).toEqual({ opus: 1, sonnet: 1, haiku: 1, other: 1 });
    expect(cnt(all.status)).toEqual({ live: 1, idle: 1, ended: 2 });
    expect(cnt(all.role)).toEqual({ main: 4, coder: 1 });

    const f = (await get<SessionsResponse>(`/api/sessions?${SINCE}&facets=1&family=haiku&project=acme%2Fweb`)).facets!;
    expect(cnt(f.family)).toEqual({ opus: 1, haiku: 1 }); // family ignores family=haiku, keeps project
    expect(cnt(f.project)).toEqual({ "acme/web": 1 }); // project ignores its own, keeps family=haiku (s3 only)
    expect(cnt(f.status)).toEqual({ ended: 1 });
  });
});

describe("sessions groups", () => {
  test("/api/sessions/groups is not read as a session id", async () => {
    const g = await get<SessionGroups>(`/api/sessions/groups?${SINCE}&by=project`);
    expect(g.by).toBe("project");
    expect(g.total_groups).toBe(3);
  });

  test.each(["project", "family", "status"] as const)("by %s: sums equal the list totals across all pages", async (by) => {
    const g = await get<SessionGroups>(`/api/sessions/groups?${SINCE}&by=${by}`);
    const p1 = await get<Page<SessionRow>>(`/api/sessions?${SINCE}&pageSize=2`);
    const p2 = await get<Page<SessionRow>>(`/api/sessions?${SINCE}&pageSize=2&page=2`);
    const rows = [...p1.items, ...p2.items];
    const sum = (xs: GroupRow[], k: "count" | "cost_usd" | "requests") => xs.reduce((a, x) => a + x[k], 0);
    expect(sum(g.groups, "count")).toBe(p1.total);
    expect(sum(g.groups, "cost_usd")).toBeCloseTo(rows.reduce((a, r) => a + r.cost_usd, 0), 10);
    expect(sum(g.groups, "requests")).toBe(rows.reduce((a, r) => a + r.requests, 0));
    expect(g.groups.map((x) => x.cost_usd)).toEqual(g.groups.map((x) => x.cost_usd).sort((a, b) => b - a));
  });

  test("groups honour filters", async () => {
    const g = await get<SessionGroups>(`/api/sessions/groups?${SINCE}&by=project&family=haiku`);
    expect(g.groups.map((x) => [x.key, x.count])).toEqual([["acme/web", 1]]);
  });
});

describe("meta, favicon, migration, family sql", () => {
  test("favicon is 200 image/svg+xml on both paths", async () => {
    for (const path of ["/favicon.svg", "/favicon.ico"]) {
      const res = call(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(await res.text()).toContain("<svg");
    }
  });

  test("migrations create the v2 indexes and re-opening is a no-op", () => {
    const version = () => db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    const indexes = () => db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    expect(version()).toBe(3);
    for (const name of ["sessions_last_ts", "sessions_project", "agents_session", "tool_calls_session"]) expect(indexes()).toContain(name);
    const again = openDb(join(ctx.app, "data.db"));
    expect(again.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(3);
    again.close();
  });

  test("FAMILY_SQL matches modelFamily()", () => {
    const models = ["claude-opus-5-5", "Claude-SONNET-4-6[1m]", "claude-haiku-4-5-20251001", "mystery", "", "gpt-opus-clone", "fable-5-2", "claude-FABLE-5-2[1m]"];
    for (const m of models) {
      const sql = db.query<{ f: string }, { m: string }>(`SELECT ${FAMILY_SQL("$m")} AS f`).get({ m })!.f;
      expect(sql).toBe(modelFamily(m));
    }
  });
});
