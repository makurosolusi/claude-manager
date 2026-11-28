import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { configPath, loadConfig } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { WriteSession } from "../src/server/write.guard.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const PORT = 5757; // test-only
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "s".repeat(64); // test-only token
const RW: WriteSession = { readOnly: false, token: TOKEN };
const agent = (name: string) => ({ name, description: "d", model: { tier: "work" }, tools: ["Read"] });
let db: Database;

const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};
const call = async (req: Request, session = RW) => (await handleRequest(req, db, PORT, undefined, session))!;
const etag = async () => ((await (await call(new Request(`${BASE}/api/agents`))).json()) as { etag: string }).etag;
const writeReq = (method: string, path: string, match: string, body?: unknown) =>
  new Request(BASE + path, {
    method,
    headers: { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", "if-match": match },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const send = async (method: string, path: string, body?: unknown) => call(writeReq(method, path, await etag(), body));
/** config.json bytes + the agents dir listing with contents: "nothing changed on disk". */
const disk = () => {
  const dir = join(ctx.claude, "agents");
  const files = readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), "utf8")]);
  return { config: existsSync(configPath()) ? readFileSync(configPath(), "utf8") : "none", files };
};

beforeEach(async () => {
  db = openDb();
  await quiet(["install"]);
  expect((await send("POST", "/api/agents", agent("seed"))).status).toBe(201); // config.json exists from here on
});
afterEach(() => {
  db.close();
  delete (Object.prototype as Record<string, unknown>).prompt;
});

describe("lost update", () => {
  test("two parallel writes on the same etag: exactly one 2xx and one 412; config has only the winner", async () => {
    const match = await etag();
    const [a, b] = await Promise.all([
      call(writeReq("POST", "/api/agents", match, agent("role-a"))),
      call(writeReq("POST", "/api/agents", match, agent("role-b"))),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 412]);
    const winner = a.status === 201 ? "role-a" : "role-b";
    const loser = winner === "role-a" ? "role-b" : "role-a";
    const roles = Object.keys((await loadConfig()).customRoles).sort();
    expect(roles).toEqual(["seed", winner].sort());
    expect(existsSync(join(ctx.claude, "agents", `${loser}.md`))).toBe(false);
  });
});

describe("prototype names", () => {
  test("POST __proto__ / constructor is 400", async () => {
    for (const name of ["__proto__", "constructor", "toString"]) expect((await send("POST", "/api/agents", agent(name))).status).toBe(400);
  });
  test("PATCH and DELETE on __proto__ / constructor are 400 and Object.prototype stays clean", async () => {
    const before = disk();
    for (const name of ["__proto__", "constructor", "toString"]) {
      expect((await send("PATCH", `/api/agents/${name}`, { prompt: "x" })).status).toBe(400);
      expect((await send("DELETE", `/api/agents/${name}`)).status).toBe(400);
    }
    expect(({} as { prompt?: string }).prompt).toBeUndefined();
    expect(disk()).toEqual(before);
  });
  test("POST with a missing or non-string name is 400 name is required", async () => {
    for (const name of [undefined, 5, null]) {
      const res = await send("POST", "/api/agents", { ...agent("x"), name });
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "name is required"]);
    }
  });
});

describe("path names", () => {
  test("%2F and ..%2F on PATCH and DELETE are 400 and nothing changes on disk", async () => {
    const before = disk();
    for (const raw of ["seed%2Fx", "..%2Fseed", "..%2F..%2Fsettings", "%2E%2E%2Fseed"]) {
      expect((await send("PATCH", `/api/agents/${raw}`, { prompt: "x" })).status).toBe(400);
      expect((await send("DELETE", `/api/agents/${raw}`)).status).toBe(400);
    }
    expect(disk()).toEqual(before);
  });
  test("usage-only plugin/unknown agents and built-ins are 409, not 404", async () => {
    const now = new Date().toISOString();
    db.run("INSERT INTO sessions (id, main_agent) VALUES ('s1', NULL)");
    db.run("INSERT INTO agents (id, session_id, agent_type) VALUES ('a1', 's1', 'acme:linter'), ('a2', 's1', 'ghost')");
    for (const [id, a] of [["m1", "a1"], ["m2", "a2"]]) {
      db.run(
        `INSERT INTO requests (message_id, session_id, agent_id, ts, model, input, cache_5m, cache_1h, cache_read, output, thinking, web_search, cost_usd, pricing_version, is_sidechain)
         VALUES (?, 's1', ?, ?, 'claude-opus-5-5', 1, 0, 0, 0, 1, 0, 0, 1, 'v', 0)`,
        [id!, a!, now],
      );
    }
    for (const name of ["acme%3Alinter", "ghost", "Explore"]) {
      expect((await send("PATCH", `/api/agents/${name}`, { prompt: "x" })).status).toBe(409);
      expect((await send("DELETE", `/api/agents/${name}`)).status).toBe(409);
    }
  });
});

describe("no CORS", () => {
  test("no response carries an Access-Control-* header", async () => {
    const match = await etag();
    const reqs = [
      new Request(`${BASE}/api/session`),
      new Request(`${BASE}/api/session`, { headers: { origin: "https://evil.example" } }),
      new Request(`${BASE}/api/agents`, { headers: { origin: "https://evil.example" } }),
      new Request(`${BASE}/api/agents/coder`),
      new Request(`${BASE}/api/overview`),
      new Request(`${BASE}/api/agents`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } }),
      new Request(`${BASE}/api/nope`),
      new Request(`${BASE}/api/agents`, { headers: { host: "evil.example" } }),
      writeReq("POST", "/api/agents", "stale", agent("x")),
      writeReq("PATCH", "/api/agents/seed", match, { prompt: "y" }),
    ];
    for (const req of reqs) {
      const res = await call(req);
      expect([req.method, req.url, [...res.headers.keys()].filter((k) => k.startsWith("access-control-"))]).toEqual([req.method, req.url, []]);
    }
  });
});
