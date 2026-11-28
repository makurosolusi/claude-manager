import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { rolesCommand } from "../src/commands/roles.command.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import type { AgentWriteResult } from "../src/server/agents.types.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { WriteSession } from "../src/server/write.guard.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
// test-only token
const TOKEN = "t".repeat(64);
const RW: WriteSession = { readOnly: false, token: TOKEN };
const UI_UX = { name: "ui-ux", description: "UI/UX specialist", model: { tier: "work" }, tools: ["Read", "Grep", "Glob", "Edit", "Write"] };
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
const etag = async () => {
  const s = await handleRequest(new Request(`${BASE}/api/agents`), db, PORT, undefined, RW)!;
  return ((await s!.json()) as { etag: string }).etag;
};
async function send(method: string, path: string, body?: unknown, over: { headers?: Record<string, string>; session?: WriteSession; match?: string | null } = {}) {
  const headers: Record<string, string> = { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", ...over.headers };
  const match = over.match === undefined ? await etag() : over.match;
  if (match !== null) headers["if-match"] = match;
  const res = await handleRequest(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), db, PORT, undefined, over.session ?? RW);
  return res!;
}
const agentFile = (name: string) => join(ctx.claude, "agents", `${name}.md`);
const config = () => (existsSync(configPath()) ? readFileSync(configPath(), "utf8") : "none");
const backups = () => readdirSync(join(ctx.app, "backups")).filter((f) => f.endsWith("config.json"));
const msg = async (res: Response) => ((await res.json()) as { error: string }).error;

beforeEach(async () => {
  db = openDb();
  await quiet(["install"]);
});
afterEach(() => db.close());

describe("session", () => {
  test("writable session exposes the token, uncached", async () => {
    const res = (await handleRequest(new Request(`${BASE}/api/session`), db, PORT, undefined, RW))!;
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ write: true, token: TOKEN });
  });
  test("read-only session has no token; foreign Host is 403", async () => {
    const ro = { readOnly: true, token: null };
    const res = (await handleRequest(new Request(`${BASE}/api/session`), db, PORT, undefined, ro))!;
    expect(await res.json()).toEqual({ write: false, token: null });
    const evil = new Request(`${BASE}/api/session`, { headers: { host: "evil.example" } });
    expect((await handleRequest(evil, db, PORT, undefined, RW))!.status).toBe(403);
  });
  test("read-only: every write is 403 and nothing changes", async () => {
    const ro = { readOnly: true, token: null };
    const before = config();
    for (const [m, p, b] of [["POST", "/api/agents", UI_UX], ["PATCH", "/api/agents/coder", { enabled: false }], ["DELETE", "/api/agents/ui-ux", undefined]] as const) {
      const res = await send(m, p, b, { session: ro });
      expect(res.status).toBe(403);
      expect(await msg(res)).toContain("read-only");
    }
    expect(config()).toBe(before);
  });
});

describe("CSRF guard", () => {
  test("no token, wrong origin, cross-site, text/plain", async () => {
    expect((await send("POST", "/api/agents", UI_UX, { headers: { "x-cm-token": "" } })).status).toBe(403);
    expect((await send("POST", "/api/agents", UI_UX, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await send("POST", "/api/agents", UI_UX, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await send("POST", "/api/agents", UI_UX, { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(existsSync(agentFile("ui-ux"))).toBe(false);
  });
});

describe("status codes", () => {
  test("428 without If-Match, 412 when stale", async () => {
    expect((await send("POST", "/api/agents", UI_UX, { match: null })).status).toBe(428);
    const res = await send("POST", "/api/agents", UI_UX, { match: "stale" });
    expect(res.status).toBe(412);
    expect(await msg(res)).toBe("config changed outside this page; reload");
  });
  test("400 invalid name, unknown field; 404; 409 duplicate, preset delete", async () => {
    expect((await send("POST", "/api/agents", { ...UI_UX, name: "Bad Name" })).status).toBe(400);
    const unknown = await send("POST", "/api/agents", { ...UI_UX, color: "red" });
    expect([unknown.status, await msg(unknown)]).toEqual([400, 'unknown field "color"']);
    expect((await send("PATCH", "/api/agents/nope", { prompt: "x" })).status).toBe(404);
    expect((await send("POST", "/api/agents", UI_UX)).status).toBe(201);
    expect((await send("POST", "/api/agents", UI_UX)).status).toBe(409);
    const del = await send("DELETE", "/api/agents/coder");
    expect([del.status, await msg(del)]).toEqual([409, `presets can't be deleted; disable it with PATCH {"enabled":false}`]);
  });
  test("write to an external agent is 409 with its path", async () => {
    mkdirSync(join(ctx.claude, "agents"), { recursive: true });
    writeFileSync(agentFile("outsider"), "---\nname: outsider\ndescription: d\n---\nbody\n");
    const res = await send("PATCH", "/api/agents/outsider", { prompt: "x" });
    expect([res.status, await msg(res)]).toEqual([409, `"outsider" is not managed by claude-manager; edit ${agentFile("outsider")} directly`]);
    expect((await send("DELETE", "/api/agents/outsider")).status).toBe(409);
  });
  test("create over an external file is 409 and keeps the file", async () => {
    mkdirSync(join(ctx.claude, "agents"), { recursive: true });
    writeFileSync(agentFile("ui-ux"), "mine\n");
    const before = config();
    const res = await send("POST", "/api/agents", UI_UX);
    expect(res.status).toBe(409);
    expect(await msg(res)).toContain("isn't managed by claude-manager");
    expect(readFileSync(agentFile("ui-ux"), "utf8")).toBe("mine\n");
    expect(config()).toBe(before);
  });
  test("hand-edited managed file is 409 and config bytes are unchanged", async () => {
    expect((await send("POST", "/api/agents", UI_UX)).status).toBe(201);
    writeFileSync(agentFile("ui-ux"), `${readFileSync(agentFile("ui-ux"), "utf8")}\nhand edit\n`);
    const before = config();
    const res = await send("PATCH", "/api/agents/ui-ux", { prompt: "new" });
    expect(res.status).toBe(409);
    expect(await msg(res)).toContain("edited by hand");
    expect(config()).toBe(before);
  });
  test("PATCH is idempotent: same body twice leaves config bytes identical", async () => {
    await send("POST", "/api/agents", UI_UX);
    const body = { prompt: "Be brief." };
    expect((await send("PATCH", "/api/agents/ui-ux", body)).status).toBe(200);
    const after1 = config();
    const count = backups().length;
    const res = await send("PATCH", "/api/agents/ui-ux", body);
    expect(res.status).toBe(200);
    expect(((await res.json()) as AgentWriteResult).applied).toBe(0);
    expect(config()).toBe(after1);
    expect(backups().length).toBe(count);
  });
});

describe("full flow", () => {
  test("create, patch, disable/enable preset, delete, re-create + uninstall", async () => {
    const created = await send("POST", "/api/agents", UI_UX);
    expect(created.status).toBe(201);
    const body = (await created.json()) as AgentWriteResult;
    expect(body.agent.name).toBe("ui-ux");
    expect(body.applied).toBe(1);
    expect(body.etag).toBe(await etag());
    expect(existsSync(agentFile("ui-ux"))).toBe(true);

    const out: string[] = [];
    const log = console.log;
    console.log = (s?: unknown) => void out.push(String(s));
    try {
      await rolesCommand.run([]);
    } finally {
      console.log = log;
    }
    expect(out.join("\n")).toContain("ui-ux");

    const fileBefore = readFileSync(agentFile("ui-ux"), "utf8");
    const patched = await send("PATCH", "/api/agents/ui-ux", { prompt: "Design carefully." });
    expect(patched.status).toBe(200);
    expect(readFileSync(agentFile("ui-ux"), "utf8")).not.toBe(fileBefore);
    expect(backups().length).toBeGreaterThan(0);

    expect((await send("PATCH", "/api/agents/writer", { enabled: false })).status).toBe(200);
    expect(existsSync(agentFile("writer"))).toBe(false);
    const row = ((await (await handleRequest(new Request(`${BASE}/api/agents`), db, PORT, undefined, RW)!)!.json()) as { items: { name: string; status: string }[] }).items.find((a) => a.name === "writer");
    expect(row?.status).toBe("disabled");
    expect((await send("PATCH", "/api/agents/writer", { enabled: true })).status).toBe(200);
    expect(existsSync(agentFile("writer"))).toBe(true);

    const del = await send("DELETE", "/api/agents/ui-ux");
    expect(del.status).toBe(200);
    expect(((await del.json()) as { removed: string }).removed).toBe("ui-ux");
    expect(existsSync(agentFile("ui-ux"))).toBe(false);

    expect((await send("POST", "/api/agents", UI_UX)).status).toBe(201);
    await quiet(["uninstall"]);
    expect(existsSync(agentFile("ui-ux"))).toBe(false);
  });
});
