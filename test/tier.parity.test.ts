import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { TiersResponse } from "../src/server/tiers.types.ts";

const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
// test-only token
const TOKEN = "t".repeat(64);
const MODEL = "claude-sonnet-5";
const homes: string[] = [];

const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};

/** Fresh HOME with a real install; returns its files after `act`. Sequential: env vars are process-global. */
async function inHome(act: (db: Database) => Promise<unknown>) {
  const home = mkdtempSync(join(tmpdir(), "cm-parity-"));
  homes.push(home);
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
  process.env.CLAUDE_MANAGER_HOME = join(home, ".claude-manager");
  const db = openDb();
  try {
    await quiet(["install"]);
    const out = await act(db);
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "none"); // a rejected set writes no config.json
    return { out, config: read(configPath()), settings: read(join(home, ".claude", "settings.json")) };
  } finally {
    db.close();
  }
}

const putApi = (db: Database, model: string) => async () => {
  const tiers = (await (await handleRequest(new Request(`${BASE}/api/tiers`), db, PORT, undefined, { readOnly: false, token: TOKEN }))!.json()) as TiersResponse;
  const headers = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", "if-match": tiers.etag };
  return handleRequest(new Request(`${BASE}/api/tiers/work`, { method: "PUT", headers, body: JSON.stringify({ model }) }), db, PORT, undefined, { readOnly: false, token: TOKEN })!;
};

afterAll(() => {
  for (const h of homes) rmSync(h, { recursive: true, force: true });
});

describe("tier set: CLI and API parity", () => {
  test("same model gives byte-identical config.json and settings.json", async () => {
    const cli = await inHome(() => quiet(["tier", "set", "work", MODEL]));
    const api = await inHome((db) => putApi(db, MODEL)());
    expect(((api.out as Response)).status).toBe(200);
    expect(api.config).toBe(cli.config);
    expect(api.settings.replaceAll(/\/[^"]*cm-parity-[^/"]*/g, "<home>")).toBe(cli.settings.replaceAll(/\/[^"]*cm-parity-[^/"]*/g, "<home>"));
  });

  test("an alias is rejected by both with the same text", async () => {
    const cli = await inHome(async () => run(["tier", "set", "work", "sonnet"]).catch((e: Error) => e));
    expect((cli.out as Error).message).toBe('model must be a full model ID, not the alias "sonnet"');
    const api = await inHome(async (db) => {
      const res = await putApi(db, "sonnet")();
      return { status: res.status, error: ((await res.json()) as { error: string }).error };
    });
    expect(api.out).toEqual({ status: 400, error: (cli.out as Error).message });
  });
});
