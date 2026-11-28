import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { policySnapshotPath } from "../src/policy/policy.paths.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { PolicyPreview, PolicyResponse } from "../src/server/policy.types.ts";
import type { WriteSession } from "../src/server/write.guard.ts";

const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(64); // test-only token
const RW: WriteSession = { readOnly: false, token: TOKEN };
const ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_MANAGER_HOME", "CLAUDE_MANAGER_DEV_POLICY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homes: string[] = [];
let db: Database;

function useHome(home: string) {
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = join(home, ".claude");
  process.env.CLAUDE_MANAGER_HOME = join(home, ".claude-manager");
  process.env.CLAUDE_MANAGER_DEV_POLICY = "1"; // source-run hook opt-in
}
async function cli(home: string, argv: string[]) {
  useHome(home);
  const log = console.log;
  console.log = () => {};
  try {
    expect(await run(argv)).toBe(0);
  } finally {
    console.log = log;
  }
}
async function api(home: string, method: string, path: string, body?: unknown, ifMatch?: string) {
  useHome(home);
  const headers: Record<string, string> = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json" };
  const etag = ifMatch ?? ((await (await handleRequest(new Request(`${BASE}/api/policy`), db, PORT, undefined, RW))!.json()) as PolicyResponse).etag;
  headers["if-match"] = etag;
  const req = new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = (await handleRequest(req, db, PORT, undefined, RW))!;
  expect(res.status).toBe(200);
  return res.json();
}
/** config.json, settings.json and snapshot bytes, with the home path replaced (snapshot `owned` keys are absolute). */
function files(home: string) {
  useHome(home);
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").replaceAll(home, "<HOME>") : "none");
  return { config: read(configPath()), settings: read(join(home, ".claude", "settings.json")), snapshot: read(policySnapshotPath()) };
}

beforeEach(async () => {
  db = openDb();
  homes = [mkdtempSync(join(tmpdir(), "cm-ppar-a-")), mkdtempSync(join(tmpdir(), "cm-ppar-b-"))];
  for (const h of homes) await cli(h, ["install"]);
});
afterEach(() => {
  db.close();
  for (const h of homes) rmSync(h, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("CLI apply/set/disable and PUT/PATCH/DELETE leave identical config, settings and snapshot bytes", async () => {
  const [a, b] = homes as [string, string];

  await cli(a, ["policy", "apply", "balanced", "--yes"]);
  const input = { preset: "balanced", scope: "user" };
  useHome(b);
  const preview = (await (await handleRequest(new Request(`${BASE}/api/policy/preview`, {
    method: "POST", headers: { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify(input),
  }), db, PORT, undefined, RW))!.json()) as PolicyPreview;
  await api(b, "PUT", "/api/policy", { ...input, confirm: true }, preview.etag);
  expect(files(b)).toEqual(files(a));
  expect(files(a).snapshot).not.toBe("none");

  await cli(a, ["policy", "set", "coder", "edit", "deny"]);
  await api(b, "PATCH", "/api/policy/rows/coder", { edit: "deny" });
  expect(files(b)).toEqual(files(a));
  expect(JSON.parse(files(a).snapshot).matrix.coder.edit).toBe("deny");

  await cli(a, ["policy", "set", "coder", "shell", "allow"]);
  await api(b, "PATCH", "/api/policy/rows/coder", { shell: "allow" });
  expect(files(b)).toEqual(files(a));

  await cli(a, ["policy", "escalate", "off"]);
  await api(b, "PATCH", "/api/policy", { escalate: false });
  expect(files(b)).toEqual(files(a));
  expect(JSON.parse(files(a).snapshot).escalate).toBe(false);

  await cli(a, ["policy", "disable"]);
  await api(b, "DELETE", "/api/policy");
  expect(files(b)).toEqual(files(a));
  expect(files(a).snapshot).toBe("none");
});
