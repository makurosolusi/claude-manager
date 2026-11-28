import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { policySnapshotPath } from "../src/policy/policy.paths.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { PolicyPreview, PolicyResponse, PolicyWriteResult } from "../src/server/policy.types.ts";
import type { WriteSession } from "../src/server/write.guard.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(64); // test-only token
const RW: WriteSession = { readOnly: false, token: TOKEN };
const RO: WriteSession = { readOnly: true, token: null };
const BALANCED = { preset: "balanced", scope: "user" };
const READ_ONLY_ERROR = "dashboard is read-only (started with --read-only)";
let db: Database;
let cwd: string;

const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};
const settingsFile = () => join(ctx.claude, "settings.json");
const text = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "none");
const call = (req: Request, session = RW) => handleRequest(req, db, PORT, undefined, session) as Promise<Response>;
const get = async <T = PolicyResponse>(path = "/api/policy", session = RW) => {
  const res = await call(new Request(BASE + path), session);
  return { res, body: (await res.json()) as T };
};
type Over = { headers?: Record<string, string>; session?: WriteSession; match?: string | null };
async function send(method: string, path: string, body?: unknown, over: Over = {}) {
  const headers: Record<string, string> = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", ...over.headers };
  const match = over.match === undefined ? (await get()).body.etag : over.match;
  if (match !== null) headers["if-match"] = match;
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  return call(new Request(BASE + path, init), over.session ?? RW);
}
const preview = async (input: unknown = BALANCED) => send("POST", "/api/policy/preview", input, { match: null });
const put = async (input: Record<string, unknown> = BALANCED, over: Over = {}) => {
  const p = (await (await preview(input)).json()) as PolicyPreview;
  return send("PUT", "/api/policy", { ...input, confirm: true }, { match: p.etag, ...over });
};
const error = async (res: Response) => ((await res.json()) as { error: string }).error;

beforeEach(async () => {
  cwd = process.cwd();
  db = openDb();
  await quiet(["install"]);
});
afterEach(() => {
  process.chdir(cwd);
  db.close();
});

describe("PATCH /api/policy (escalate)", () => {
  test("200 toggles escalate, re-applies the snapshot; GET reports null when the field is missing", async () => {
    await put();
    expect((await get()).body.config!.escalate).toBe(true);
    const res = await send("PATCH", "/api/policy", { escalate: false });
    expect(res.status).toBe(200);
    const r = (await res.json()) as PolicyWriteResult;
    expect(r.policy.config!.escalate).toBe(false);
    expect(JSON.parse(text(policySnapshotPath())).escalate).toBe(false);
    expect((await get()).body.config!.escalate).toBe(false);
    const stored = JSON.parse(text(configPath()));
    delete stored.policy.escalate;
    writeFileSync(configPath(), JSON.stringify(stored));
    expect((await get()).body.config!.escalate).toBeNull();
  });

  test("a v0.4.0 policy (no escalate) upgrades to on when re-applied without a choice, and stays off when the owner picks off", async () => {
    await put({ ...BALANCED, escalate: false });
    const stored = JSON.parse(text(configPath()));
    delete stored.policy.escalate;
    writeFileSync(configPath(), JSON.stringify(stored));
    await put({ preset: "strict", scope: "user" });
    expect((await get()).body.config!.escalate).toBe(true);
    delete stored.policy.escalate;
    writeFileSync(configPath(), JSON.stringify(stored));
    await put({ ...BALANCED, escalate: false });
    expect((await get()).body.config!.escalate).toBe(false);
  });

  test("PUT keeps the stored escalate and accepts an explicit one", async () => {
    await put();
    await send("PATCH", "/api/policy", { escalate: false });
    await put({ preset: "strict", scope: "user" });
    expect(JSON.parse(text(configPath())).policy.escalate).toBe(false);
    await put({ ...BALANCED, escalate: true });
    expect(JSON.parse(text(configPath())).policy.escalate).toBe(true);
    expect((await put({ ...BALANCED, escalate: "yes" })).status).toBe(400);
  });

  test("400 unknown key, non-boolean, empty body; 409 before set up; 428 and 412", async () => {
    expect((await send("PATCH", "/api/policy", { escalate: true })).status).toBe(409);
    await put();
    for (const body of [{ escalate: "no" }, { escalate: false, extra: 1 }, {}, [], { enabled: true }]) {
      expect((await send("PATCH", "/api/policy", body)).status).toBe(400);
    }
    expect((await send("PATCH", "/api/policy", { escalate: false }, { match: null })).status).toBe(428);
    expect((await send("PATCH", "/api/policy", { escalate: false }, { match: "0".repeat(64) })).status).toBe(412);
    expect(JSON.parse(text(configPath())).policy.escalate).toBe(true);
  });

  test("403 when read-only, and without the token", async () => {
    await put();
    const res = await send("PATCH", "/api/policy", { escalate: false }, { session: RO });
    expect(res.status).toBe(403);
    expect(await error(res)).toBe(READ_ONLY_ERROR);
    expect((await send("PATCH", "/api/policy", { escalate: false }, { headers: { "x-cm-token": "" } })).status).toBe(403);
    expect(JSON.parse(text(configPath())).policy.escalate).toBe(true);
  });
});

test("--read-only: every policy write is 403 and nothing changes", async () => {
  const before = [text(configPath()), text(settingsFile())];
  const writes = [
    ["POST", "/api/policy/preview", BALANCED],
    ["PUT", "/api/policy", { ...BALANCED, confirm: true }],
    ["PATCH", "/api/policy/rows/coder", { edit: "ask" }],
    ["PATCH", "/api/policy", { escalate: false }],
    ["DELETE", "/api/policy", undefined],
  ] as const;
  for (const [method, path, body] of writes) {
    const res = await send(method, path, body, { session: RO });
    expect(res.status).toBe(403);
    expect(await error(res)).toBe(READ_ONLY_ERROR);
  }
  expect([text(configPath()), text(settingsFile())]).toEqual(before);
});

