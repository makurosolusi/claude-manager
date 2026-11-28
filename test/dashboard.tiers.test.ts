import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { TierWriteResult, TiersResponse } from "../src/server/tiers.types.ts";
import type { WriteSession } from "../src/server/write.guard.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
// test-only token
const TOKEN = "t".repeat(64);
const RW: WriteSession = { readOnly: false, token: TOKEN };
const NEW_MODEL = "claude-sonnet-5";
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
const get = async (session: WriteSession = RW) => (await handleRequest(new Request(`${BASE}/api/tiers`), db, PORT, undefined, session))!;
const etag = async () => ((await (await get()).json()) as TiersResponse).etag;
async function put(tier: string, body: unknown, over: { headers?: Record<string, string>; session?: WriteSession; match?: string | null } = {}) {
  const headers: Record<string, string> = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", ...over.headers };
  const match = over.match === undefined ? await etag() : over.match;
  if (match !== null) headers["if-match"] = match;
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return (await handleRequest(new Request(`${BASE}/api/tiers/${tier}`, { method: "PUT", headers, body: raw }), db, PORT, undefined, over.session ?? RW))!;
}
const msg = async (res: Response) => ((await res.json()) as { error: string }).error;
const settings = () => JSON.parse(readFileSync(join(ctx.claude, "settings.json"), "utf8")) as { env: Record<string, string> };
const backups = () => (existsSync(join(ctx.app, "backups")) ? readdirSync(join(ctx.app, "backups")).filter((f) => f.endsWith("config.json")) : []);

beforeEach(async () => {
  db = openDb();
  await quiet(["install"]);
});
afterEach(() => db.close());

describe("GET /api/tiers", () => {
  test("returns three tiers, models and an etag; works read-only", async () => {
    const res = await get({ readOnly: true, token: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TiersResponse;
    expect(body.tiers.map((t) => t.tier)).toEqual(["think", "work", "basic"]);
    expect(body.days).toBe(30);
    expect(body.etag).toBe(await etag());
  });
  test("GET /api/tiers/work is 404", async () => {
    const res = (await handleRequest(new Request(`${BASE}/api/tiers/work`), db, PORT, undefined, RW))!;
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/tiers/:tier status table", () => {
  test("428 without If-Match", async () => {
    const res = await put("work", { model: NEW_MODEL }, { match: null });
    expect([res.status, await msg(res)]).toEqual([428, "If-Match header is required"]);
  });
  test("404 unknown tier", async () => {
    const res = await put("x", { model: NEW_MODEL });
    expect([res.status, await msg(res)]).toEqual([404, 'unknown tier "x": use think, work, basic']);
  });
  test("400 bad body shapes", async () => {
    const text = 'body must be {"model": "<model-id>"}';
    for (const body of [[], "[1]", "null", { model: 5 }, { model: "a", extra: 1 }, {}, { other: "a" }]) {
      const res = await put("work", body);
      expect([res.status, await msg(res)]).toEqual([400, text]);
    }
  });
  test("400 invalid and over-long ids", async () => {
    const bad = await put("work", { model: "has space" });
    expect([bad.status, await msg(bad)]).toEqual([400, 'invalid model id "has space"']);
    const long = await put("work", { model: "x".repeat(129) });
    expect(long.status).toBe(400);
    expect(await msg(long)).toStartWith("invalid model id");
  });
  test("400 alias values", async () => {
    const res = await put("work", { model: "sonnet" });
    expect([res.status, await msg(res)]).toEqual([400, 'model must be a full model ID, not the alias "sonnet"']);
    expect((await put("work", { model: "opusplan" })).status).toBe(400);
  });
  test("412 stale etag", async () => {
    const res = await put("work", { model: NEW_MODEL }, { match: "stale" });
    expect([res.status, await msg(res)]).toEqual([412, "config changed outside this page; reload"]);
  });
  test("409 dry-run conflict passes the message through", async () => {
    await Bun.write(join(ctx.claude, "agents", "coder.md"), "hand-written, not ours\n");
    const res = await put("work", { model: NEW_MODEL });
    expect(res.status).toBe(409);
    expect(await msg(res)).toContain("coder.md");
  });
  test("500 carries the operation and cause", async () => {
    await put("work", { model: NEW_MODEL }); // creates config.json, so the next write has to back it up
    await Bun.write(join(ctx.app, "backups"), "a file where the backup dir should be");
    const res = await put("work", { model: "claude-other-1" });
    expect(res.status).toBe(500);
    expect(await msg(res)).toStartWith('PUT tier "work": ');
  });
  test("200 result, settings.json env changes", async () => {
    const before = ((await (await get()).json()) as TiersResponse).tiers.find((t) => t.tier === "work")!.model;
    const res = await put("work", { model: NEW_MODEL });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TierWriteResult;
    expect(body).toMatchObject({ tier: "work", model: NEW_MODEL, previous: before });
    expect(body.applied).toBeGreaterThan(0);
    expect(body.etag).toBe(await etag());
    expect(settings().env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(NEW_MODEL);
  });
});

describe("PUT guards and concurrency", () => {
  test("403 read-only and without a token; nothing written", async () => {
    await put("work", { model: NEW_MODEL });
    const before = readFileSync(configPath(), "utf8");
    expect((await put("work", { model: "claude-other-1" }, { session: { readOnly: true, token: null } })).status).toBe(403);
    expect((await put("work", { model: "claude-other-1" }, { headers: { "x-cm-token": "" } })).status).toBe(403);
    expect(readFileSync(configPath(), "utf8")).toBe(before);
  });
  test("405 for other methods on the item route and for PUT elsewhere", async () => {
    for (const [method, path] of [["OPTIONS", "/api/tiers/work"], ["POST", "/api/tiers/work"], ["PUT", "/api/tiers"], ["PUT", "/api/overview"]] as const) {
      const res = (await handleRequest(new Request(BASE + path, { method, headers: { origin: BASE } }), db, PORT, undefined, RW))!;
      expect(res.status).toBe(405);
    }
  });
  test("a no-op PUT is 200 applied 0 and writes no backup", async () => {
    await put("work", { model: NEW_MODEL });
    const count = backups().length;
    const text = readFileSync(configPath(), "utf8");
    const res = await put("work", { model: NEW_MODEL });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TierWriteResult).applied).toBe(0);
    expect(backups()).toHaveLength(count);
    expect(readFileSync(configPath(), "utf8")).toBe(text);
  });
  test("two parallel PUTs with the same etag: one 200, one 412", async () => {
    const match = await etag();
    const [a, b] = await Promise.all([put("work", { model: "claude-a-1" }, { match }), put("think", { model: "claude-b-1" }, { match })]);
    expect([a.status, b.status].sort()).toEqual([200, 412]);
  });
});
