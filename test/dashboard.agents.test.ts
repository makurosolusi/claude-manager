import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { PRESET_ROLES } from "../src/roles/roles.presets.ts";
import type { AgentDetail, AgentsResponse } from "../src/server/agents.types.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import { useTempHome } from "./test.home.ts";

// test-only fixtures: synthetic rows and files, never real logs.
const ctx = useTempHome();
const BASE = "http://127.0.0.1:5757";
let db: Database;
const call = async (path: string, method = "GET") => (await handleRequest(new Request(BASE + path, { method }), db, 5757))!;
const saveConfig = (data: unknown) => {
  mkdirSync(ctx.app, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(data));
};

beforeEach(() => {
  db = openDb();
  db.run("INSERT INTO sessions (id, main_agent) VALUES ('s1', NULL)");
  db.run("INSERT INTO agents (id, session_id, agent_type) VALUES ('a1', 's1', 'reviewer')");
  db.run(
    `INSERT INTO requests (message_id, session_id, agent_id, ts, model, input, cache_5m, cache_1h, cache_read, output, thinking, web_search, cost_usd, pricing_version, is_sidechain)
     VALUES ('m1', 's1', 'a1', ?, 'claude-opus-5-5', 1, 0, 0, 0, 1, 0, 0, 2, 'v', 0)`,
    [new Date().toISOString()],
  );
});
afterEach(() => db.close());

describe("GET /api/agents", () => {
  test("lists presets with usage and a disabled preset", async () => {
    saveConfig({ disabledRoles: ["reviewer"] });
    const res = await call("/api/agents");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentsResponse;
    const names = body.items.map((a) => a.name);
    for (const r of PRESET_ROLES) expect(names).toContain(r.name);
    const reviewer = body.items.find((a) => a.name === "reviewer")!;
    expect(reviewer.status).toBe("disabled");
    expect(reviewer.kind).toBe("preset");
    expect(reviewer.usage.requests).toBe(1);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.truncated).toBe(false);
  });

  test("an external file in ~/.claude/agents is external, source file", async () => {
    mkdirSync(join(ctx.claude, "agents"), { recursive: true });
    writeFileSync(join(ctx.claude, "agents", "outsider.md"), "---\nname: outsider\ndescription: from a file\n---\nbody\n");
    const body = (await (await call("/api/agents")).json()) as AgentsResponse;
    const row = body.items.find((a) => a.name === "outsider")!;
    expect(row.kind).toBe("external");
    expect(row.source).toBe("file");
    expect(row.description).toBe("from a file");
  });

  test("config changes show up without a restart", async () => {
    const before = (await (await call("/api/agents")).json()) as AgentsResponse;
    expect(before.items.some((a) => a.name === "qa-extra")).toBe(false);
    saveConfig({ customRoles: { "qa-extra": { tier: "basic", description: "x" } } });
    const after = (await (await call("/api/agents")).json()) as AgentsResponse;
    expect(after.items.find((a) => a.name === "qa-extra")?.kind).toBe("custom");
  });
});

describe("GET /api/agents/:name", () => {
  test("returns the detail of a known agent", async () => {
    const res = await call("/api/agents/reviewer");
    expect(res.status).toBe(200);
    const d = (await res.json()) as AgentDetail;
    expect(d.name).toBe("reviewer");
    expect(Array.isArray(d.warnings)).toBe(true);
    expect(typeof d.etag).toBe("string");
  });

  test("URL-decodes the name", async () => {
    saveConfig({ customRoles: { "qa-extra": { tier: "basic", description: "x" } } });
    expect(((await (await call("/api/agents/qa%2Dextra")).json()) as AgentDetail).name).toBe("qa-extra");
  });

  test("unknown name is 404 with the error shape", async () => {
    const res = await call("/api/agents/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'agent "nope" not found' });
  });

  test("an external file's detail carries its file path", async () => {
    mkdirSync(join(ctx.claude, "agents"), { recursive: true });
    const file = join(ctx.claude, "agents", "outsider.md");
    writeFileSync(file, "---\nname: outsider\ndescription: d\n---\nthe prompt\n");
    const d = (await (await call("/api/agents/outsider")).json()) as AgentDetail;
    expect([d.kind, d.source, d.file_path]).toEqual(["external", "file", file]);
  });
});

describe("unknown methods stay closed", () => {
  for (const [method, path] of [["PUT", "/api/agents"], ["PUT", "/api/agents/reviewer"], ["OPTIONS", "/api/agents/reviewer"], ["POST", "/api/agents/reviewer"]]) {
    test(`${method} ${path} is 405`, async () => {
      expect((await call(path!, method)).status).toBe(405);
    });
  }
});
