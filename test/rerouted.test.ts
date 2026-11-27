import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "../src/cli.ts";
import { openDb } from "../src/db/db.schema.ts";
import { NORMALIZE_SQL, usageTotal } from "../src/db/stats.repository.ts";
import { parseEntry } from "../src/ingest/ingest.parser.ts";
import { sync } from "../src/ingest/ingest.service.ts";
import { handleApi } from "../src/server/dashboard.api.ts";
import type { Overview, Page, RoleRow, SessionDetail, SessionRow } from "../src/server/dashboard.types.ts";
import type { RequestsResponse } from "../src/server/session.detail.types.ts";
import { fmtRerouted, rerouteNote } from "../src/web/lib/reroute.ts";
import { normalizeModel } from "../src/web/lib/model.tier.ts";
import { useTempHome } from "./test.home.ts";

// test-only fixtures: synthetic transcripts and rows, never real logs.
const ctx = useTempHome();
const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const BASE = "http://127.0.0.1:5757";
const ALL = { since: "1970-01-01T00:00:00.000Z" };
let db: Database;
beforeEach(() => {
  db = openDb();
});
afterEach(() => db.close());

const logPath = () => join(ctx.claude, "projects", "-work-app", `${SID}.jsonl`);
const line = (id: string, model: string, requestedModel?: string) =>
  JSON.stringify({ type: "assistant", sessionId: SID, timestamp: "2026-11-20T10:00:00.000Z", requestedModel, message: { id, model, usage: { input_tokens: 1, output_tokens: 1 } } });
const writeLog = (...lines: string[]) => {
  mkdirSync(dirname(logPath()), { recursive: true });
  writeFileSync(logPath(), `${lines.join("\n")}\n`);
};
const requested = () => db.query<{ message_id: string; requested_model: string | null }, []>("SELECT message_id, requested_model FROM requests ORDER BY message_id").all();
const version = () => db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;

describe("parser", () => {
  const parse = (extra: Record<string, unknown>) =>
    parseEntry({ type: "assistant", sessionId: SID, timestamp: "2026-11-20T10:00:00.000Z", ...extra, message: { id: "m", model: "claude-opus-5-5", usage: {} } }, { agentId: null, storePromptText: false }).request;

  test("captures requestedModel, NULL when absent or not a string", () => {
    expect(parse({ requestedModel: "claude-sonnet-5-5" })?.requested_model).toBe("claude-sonnet-5-5");
    expect(parse({})?.requested_model).toBeNull();
    expect(parse({ requestedModel: 5 })?.requested_model).toBeNull();
  });
});

describe("migration v3", () => {
  test("is idempotent when the column already exists", () => {
    db.run("PRAGMA user_version = 2");
    db.close();
    db = openDb(); // column is already there; ADD COLUMN would throw "duplicate column"
    expect(version()).toBe(3);
  });

  test("adds the column to a v2 database and resets file offsets", () => {
    db.run("ALTER TABLE requests DROP COLUMN requested_model");
    db.run("INSERT INTO files (path, size, mtime_ms, ino, offset) VALUES ('/x', 10, 1, 77, 10)");
    db.run("PRAGMA user_version = 2");
    db.close();
    db = openDb();
    expect(db.query("SELECT 1 FROM pragma_table_info('requests') WHERE name = 'requested_model'").get()).toBeTruthy();
    expect(db.query<{ ino: number }, []>("SELECT ino FROM files").get()!.ino).toBe(-1);
  });

  test("backfill: the next sync re-reads old lines and fills requested_model; a later NULL never erases it", async () => {
    writeLog(line("m1", "claude-opus-5-5", "claude-sonnet-5-5"));
    await sync(db);
    db.run("UPDATE requests SET requested_model = NULL"); // what a pre-v3 row looks like
    db.run("PRAGMA user_version = 2");
    db.close();
    db = openDb();
    await sync(db);
    expect(requested()).toEqual([{ message_id: "m1", requested_model: "claude-sonnet-5-5" }]);
    appendFileSync(logPath(), `${line("m1", "claude-opus-5-5")}\n`); // streaming copy without the field
    await sync(db);
    expect(requested()).toEqual([{ message_id: "m1", requested_model: "claude-sonnet-5-5" }]);
  });
});

describe("rerouted detection", () => {
  test("NORMALIZE_SQL mirrors normalizeModel()", () => {
    const ids = ["claude-opus-5-5", " Claude-SONNET-4-6[1m] ", "claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001[1m]", "x-1234567", "x-123456789", "", "[1m]"];
    for (const m of ids) {
      expect(db.query<{ n: string }, { m: string }>(`SELECT ${NORMALIZE_SQL("$m")} AS n`).get({ m })!.n).toBe(normalizeModel(m));
    }
  });

  const seed = () => {
    db.run("INSERT INTO sessions (id, project_cwd, first_ts, last_ts) VALUES ('s1', '/work/app', '2026-11-20T10:00:00Z', '2026-11-20T10:00:09Z')");
    db.run("INSERT INTO agents (id, session_id, agent_type) VALUES ('ag1', 's1', 'coder')");
    const rows: [string, string, string | null, string | null][] = [
      ["r1", "claude-opus-5-5", "claude-sonnet-5-5", "ag1"], // rerouted
      ["r2", "claude-sonnet-5-5", "claude-sonnet-5-5", "ag1"], // same
      ["r3", "claude-sonnet-4-6-20250101", "claude-sonnet-4-6[1m]", null], // suffixes only: not rerouted
      ["r4", "claude-opus-5-5", null, null], // unknown requested model: never rerouted
    ];
    rows.forEach(([id, model, req, agent], i) =>
      db.run(
        `INSERT INTO requests (message_id, session_id, agent_id, ts, model, requested_model, input, cache_5m, cache_1h, cache_read, output, thinking,
          web_search, cost_usd, pricing_version, is_sidechain) VALUES (?, 's1', ?, ?, ?, ?, 1, 0, 0, 0, 1, 0, 0, 1, 't', 0)`,
        [id, agent, `2026-11-20T10:00:0${i}Z`, model, req],
      ),
    );
  };
  const get = async <T>(path: string) => {
    const res = handleApi(new Request(`${BASE}${path}`), db)!;
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };

  test("API exposes requested_model, rerouted flag, facet and counts", async () => {
    seed();
    const all = await get<RequestsResponse>("/api/sessions/s1/requests?facets=1&sort=ts&dir=asc");
    expect(all.items.map((r) => [r.message_id, r.requested_model, r.rerouted])).toEqual([
      ["r1", "claude-sonnet-5-5", true],
      ["r2", "claude-sonnet-5-5", false],
      ["r3", "claude-sonnet-4-6[1m]", false],
      ["r4", null, false],
    ]);
    expect(all.facets!.rerouted).toEqual([{ value: "no", count: 3 }, { value: "yes", count: 1 }]);
    const yes = await get<RequestsResponse>("/api/sessions/s1/requests?rerouted=yes&facets=1");
    expect(yes.items.map((r) => r.message_id)).toEqual(["r1"]);
    expect(yes.facets!.rerouted).toHaveLength(2); // the facet ignores its own filter
    expect((await get<RequestsResponse>("/api/sessions/s1/requests?rerouted=no")).total).toBe(3);
    expect(handleApi(new Request(`${BASE}/api/sessions/s1/requests?rerouted=maybe`), db)!.status).toBe(400);

    expect((await get<SessionDetail>("/api/sessions/s1")).session.rerouted).toBe(1);
    expect((await get<Page<SessionRow>>("/api/sessions")).items[0]!.rerouted).toBe(1);
    expect((await get<Page<RoleRow>>("/api/roles")).items.map((r) => [r.role, r.model, r.rerouted]).sort()).toEqual([
      ["coder", "claude-opus-5-5", 1],
      ["coder", "claude-sonnet-5-5", 0],
      ["main", "claude-opus-5-5", 0],
      ["main", "claude-sonnet-4-6-20250101", 0],
    ]);
    expect((await get<Overview>("/api/overview?range=all")).total.rerouted).toBe(1);
  });

  test("stats output keeps its shape (no rerouted/sessions keys)", async () => {
    seed();
    const keys = ["requests", "input", "cache_write", "cache_read", "output", "cost_usd", "unpriced"];
    expect(Object.keys(usageTotal(db, ALL)).sort()).toEqual([...keys].sort());
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await run(["stats", "--since", "2026-01-01", "--json"])).toBe(0);
      const out = JSON.parse(log.mock.calls[0]![0]);
      expect(Object.keys(out.total).sort()).toEqual([...keys].sort());
    } finally {
      log.mockRestore();
    }
  });
});

test("badge helpers", () => {
  expect(rerouteNote("claude-sonnet-5-5", "claude-opus-5-5")).toContain("Requested sonnet-5-5, served by opus-5-5. A proxy or gateway (ANTHROPIC_BASE_URL)");
  expect(fmtRerouted(12, 1500)).toBe("12 of 1,500 rerouted");
});
