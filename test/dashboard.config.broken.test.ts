import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { run } from "../src/cli.ts";
import { configEtag } from "../src/config/config.apply.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { WriteSession } from "../src/server/write.guard.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
// test-only token
const TOKEN = "t".repeat(64);
const RW: WriteSession = { readOnly: false, token: TOKEN };
let db: Database;

beforeEach(async () => {
  db = openDb();
  const log = console.log;
  console.log = () => {};
  try {
    await run(["install"]);
  } finally {
    console.log = log;
  }
  mkdirSync(ctx.app, { recursive: true });
  writeFileSync(configPath(), "{bad");
});
afterEach(() => db.close());

async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", "if-match": configEtag("{bad") };
  const req = new Request(`${BASE}${path}`, { method, headers: method === "GET" ? undefined : headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = (await handleRequest(req, db, PORT, undefined, RW))!;
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
}

test("a malformed config.json is a server-side 500 naming config.json, never a 400, on read and write routes", async () => {
  const agent = { name: "ui-ux", description: "UI/UX specialist", model: { tier: "work" } };
  for (const [m, p, b] of [["PUT", "/api/tiers/work", { model: "claude-sonnet-5" }], ["POST", "/api/agents", agent], ["GET", "/api/agents", undefined], ["GET", "/api/tiers", undefined]] as const) {
    const r = await call(m, p, b);
    expect([m, p, r.status]).toEqual([m, p, 500]);
    expect(r.error).toContain("config.json");
  }
});
