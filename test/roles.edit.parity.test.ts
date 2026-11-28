import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { CliError } from "../src/cli.error.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { WriteSession } from "../src/server/write.guard.ts";

const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(64); // test-only token
const RW: WriteSession = { readOnly: false, token: TOKEN };
const UI_UX = ["roles", "add", "ui-ux", "--tier", "work", "--description", "UI/UX", "--tools", "Read,Grep"];
const ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_MANAGER_HOME"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homes: string[] = [];
let db: Database;

/** Points the process env at one of the two temp HOMEs. */
function useHome(home: string) {
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
  process.env.CLAUDE_MANAGER_HOME = join(home, ".claude-manager");
}
async function quiet(argv: string[]) {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
}
async function patch(name: string, body: unknown) {
  const list = (await handleRequest(new Request(`${BASE}/api/agents`), db, PORT, undefined, RW))!;
  const headers = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", "if-match": ((await list.json()) as { etag: string }).etag };
  return (await handleRequest(new Request(`${BASE}/api/agents/${name}`, { method: "PATCH", headers, body: JSON.stringify(body) }), db, PORT, undefined, RW))!;
}
/** config.json bytes plus sha256 of every installed agent file. */
function snapshot(home: string) {
  const dir = join(home, ".claude", "agents");
  const files = Object.fromEntries(readdirSync(dir).sort().map((f) => [f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")]));
  useHome(home);
  return { config: readFileSync(configPath(), "utf8"), files };
}

beforeEach(async () => {
  db = openDb();
  homes = [mkdtempSync(join(tmpdir(), "cm-par-a-")), mkdtempSync(join(tmpdir(), "cm-par-b-"))];
  for (const h of homes) {
    useHome(h);
    await quiet(["install"]);
  }
});
afterEach(() => {
  db.close();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Runs steps on HOME A via CLI and on HOME B via PATCH, then compares the results. */
async function parity(steps: { cli: string[]; body: unknown; name: string }[], setup: string[] = []) {
  const [a, b] = homes as [string, string];
  if (setup.length) for (const h of homes) { useHome(h); await quiet(setup); }
  for (const s of steps) {
    useHome(a);
    await quiet(["roles", "edit", s.name, ...s.cli]);
    useHome(b);
    expect((await patch(s.name, s.body)).status).toBe(200);
  }
  expect(snapshot(a)).toEqual(snapshot(b));
}

describe("roles edit parity with PATCH /api/agents/:name", () => {
  test("preset --pin fable", () => parity([{ name: "coder", cli: ["--pin", "fable"], body: { model: { pin: "fable" } } }]));
  test("preset --default", () => parity([
    { name: "coder", cli: ["--pin", "fable"], body: { model: { pin: "fable" } } },
    { name: "coder", cli: ["--default"], body: { model: { default: true } } },
  ]));
  test("--disable then --enable", () => parity([
    { name: "writer", cli: ["--disable"], body: { enabled: false } },
    { name: "writer", cli: ["--enable"], body: { enabled: true } },
  ]));
  test("custom --tier basic", () => parity([{ name: "ui-ux", cli: ["--tier", "basic"], body: { model: { tier: "basic" } } }], UI_UX));
  test("custom --tools all", () => parity([{ name: "ui-ux", cli: ["--tools", "all"], body: { tools: null } }], UI_UX));
  test("custom --description + --tools + --prompt-file", async () => {
    const prompt = "Custom prompt\nline two\n";
    const path = join(homes[0]!, "prompt.md");
    writeFileSync(path, prompt);
    await parity([{ name: "ui-ux", cli: ["--description", "x", "--tools", "Read,Grep", "--prompt-file", path], body: { description: "x", tools: ["Read", "Grep"], prompt } }], UI_UX);
  });

  test("error: CLI exit 1 and API 400 share the message", async () => {
    useHome(homes[0]!);
    const err = await run(["roles", "edit", "coder", "--description", "x"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    useHome(homes[1]!);
    const res = await patch("coder", { description: "x" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("preset agents only allow model and enabled");
    expect((err as CliError).exitCode).toBe(1);
    expect((err as CliError).message).toBe("preset agents only allow model and enabled");
  });
});
