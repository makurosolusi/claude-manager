import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { CliError } from "../src/cli.error.ts";
import { applyConfig, configEtag } from "../src/config/config.apply.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { loadManifest } from "../src/install/install.manifest.ts";
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
const manifestPath = () => join(ctx.app, "manifest.json");

beforeEach(async () => {
  db = openDb();
  const log = console.log;
  console.log = () => {};
  try {
    await run(["install"]);
  } finally {
    console.log = log;
  }
  await applyConfig((c) => c);
  writeFileSync(manifestPath(), "{bad");
});
afterEach(() => db.close());

async function call(method: string, path: string, body: unknown) {
  const etag = configEtag(readFileSync(configPath(), "utf8"));
  const headers = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", "if-match": etag };
  const res = (await handleRequest(new Request(`${BASE}${path}`, { method, headers, body: JSON.stringify(body) }), db, PORT, undefined, RW))!;
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
}

test("loadManifest: malformed manifest.json is a server-side CliError naming the file", async () => {
  const err = await loadManifest().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CliError);
  expect((err as CliError).reason).toBe("server");
  expect((err as CliError).message).toStartWith("manifest.json is not valid JSON: ");
  expect((err as CliError).message).toEndWith(`(${manifestPath()})`);
});

test("a malformed manifest.json is a 500 naming manifest.json on agents, tiers and policy writes, never a 400", async () => {
  const agent = { name: "ui-ux", description: "UI/UX specialist", model: { tier: "work" }, tools: ["Read"] };
  const routes = [["POST", "/api/agents", agent], ["PUT", "/api/tiers/work", { model: "claude-sonnet-5" }], ["PUT", "/api/policy", { preset: "balanced", scope: "user", confirm: true }]] as const;
  for (const [m, p, b] of routes) {
    const r = await call(m, p, b);
    expect([m, p, r.status]).toEqual([m, p, 500]);
    expect(r.error).toContain("manifest.json");
  }
});
