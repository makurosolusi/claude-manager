import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { configPath } from "../src/config/config.store.ts";
import { openDb } from "../src/db/db.schema.ts";
import { ingestPolicyAudit, policyAuditPath } from "../src/ingest/policy.audit.ingest.ts";
import { policySnapshotPath } from "../src/policy/policy.paths.ts";
import { OWNER_ASK_RULES, SECRET_DENY_RULES } from "../src/policy/policy.presets.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { AuditResponse, PolicyPreview, PolicyResponse, PolicyWriteResult } from "../src/server/policy.types.ts";
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

describe("GET /api/policy", () => {
  test("not set up: 200, Balanced preview rows, installed scope, works read-only, no CORS headers", async () => {
    const { res, body } = await get("/api/policy", RO);
    expect(res.status).toBe(200);
    expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
    expect(body.status).toBe("not_set_up");
    expect(body.config).toBeNull();
    expect(body.settings_path).toBeNull();
    expect(body.installed_scopes).toEqual(["user"]);
    expect(body.rows.map((r) => r.row)).toContain("coder");
    expect(body.rows.find((r) => r.row === "coder")!.cells.edit).toEqual({ decision: "allow", source: "preset" });
    expect(body.etag).toMatch(/^[0-9a-f]{64}$/);
  });

  test("after PUT: enforced, settings path and hook command; a removed hook group is drift", async () => {
    expect((await put()).status).toBe(200);
    const { body } = await get();
    expect(body.status).toBe("enforced");
    expect(body.reasons).toEqual([]);
    expect(body.settings_path).toBe(settingsFile());
    expect(body.hook_command).toEndWith("hook pre-tool-use");
    const s = JSON.parse(text(settingsFile()));
    delete s.hooks;
    writeFileSync(settingsFile(), JSON.stringify(s));
    const after = (await get()).body;
    expect(after.status).toBe("drift");
    expect(after.reasons[0]).toContain("policy hook missing");
  });

  test("unknown sub-path is 404, unknown method is 405", async () => {
    expect((await get("/api/policy/nope")).res.status).toBe(404);
    expect((await send("POST", "/api/policy", BALANCED)).status).toBe(405);
  });
});

describe("POST /api/policy/preview", () => {
  test("200 lists the owner mandate and the hook, and writes nothing", async () => {
    const before = [text(configPath()), text(settingsFile())];
    const res = await preview();
    expect(res.status).toBe(200);
    const p = (await res.json()) as PolicyPreview;
    expect(p.settings_path).toBe(settingsFile());
    const added = p.changes.filter((c) => c.op === "add").map((c) => c.value);
    for (const rule of [...OWNER_ASK_RULES, ...SECRET_DENY_RULES]) expect(added).toContain(rule);
    expect(p.changes.some((c) => c.list === "hooks.PreToolUse")).toBe(true);
    expect([text(configPath()), text(settingsFile())]).toEqual(before);
    expect(existsSync(policySnapshotPath())).toBe(false);
  });

  test("400: unknown field, bad preset, bad scope, shell metacharacters, bad override", async () => {
    const cases = [
      [{ ...BALANCED, extra: 1 }, 'unknown field "extra"'],
      [{ ...BALANCED, preset: "yolo" }, 'unknown preset "yolo"'],
      [{ ...BALANCED, scope: "global" }, 'invalid scope "global"'],
      [{ ...BALANCED, testCommands: ["bun test; rm -rf /"] }, "shell metacharacters"],
      [{ ...BALANCED, overrides: { coder: { push: "allow" } } }, "push is owner-only"],
      [[1], "body must be a JSON object"],
    ] as const;
    for (const [input, msg] of cases) {
      const res = await preview(input);
      expect(res.status).toBe(400);
      expect(await error(res)).toContain(msg);
    }
  });

  test("400 project scope outside a git repo; 409 project scope without a project install", async () => {
    process.chdir(ctx.home);
    expect(await error(await preview({ preset: "balanced", scope: "project" }))).toContain("not inside a git repository");
    const repo = join(ctx.home, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    process.chdir(repo);
    const res = await preview({ preset: "balanced", scope: "project" });
    expect(res.status).toBe(409);
    expect(await error(res)).toContain('Run "claude-manager install --scope project" first');
  });

  test("409 when the settings file is not valid JSON", async () => {
    writeFileSync(settingsFile(), "{ nope");
    const res = await preview();
    expect(res.status).toBe(409);
    expect(await error(res)).toContain(`Fix ${settingsFile()} first`);
  });
});

describe("PUT /api/policy", () => {
  test("200 enables the policy, writes settings and snapshot; result etag matches GET", async () => {
    const res = await put();
    expect(res.status).toBe(200);
    const r = (await res.json()) as PolicyWriteResult;
    expect(r.policy.status).toBe("enforced");
    expect(r.etag).toBe((await get()).body.etag);
    expect(JSON.parse(text(configPath())).policy).toEqual({ enabled: true, preset: "balanced", scope: "user", overrides: {}, escalate: true });
    const s = JSON.parse(text(settingsFile()));
    expect(s.permissions.ask).toEqual([...OWNER_ASK_RULES]);
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(JSON.parse(text(policySnapshotPath())).matrix.coder.edit).toBe("allow");
  });

  test("no-op: the same PUT again adds and removes nothing and keeps the settings bytes", async () => {
    await put();
    const before = [text(configPath()), text(settingsFile()), text(policySnapshotPath())];
    const res = await put();
    expect(res.status).toBe(200);
    const { changes } = (await res.json()) as PolicyWriteResult;
    expect(changes.filter((c) => c.op === "add" || c.op === "remove")).toEqual([]);
    expect([text(configPath()), text(settingsFile()), text(policySnapshotPath())]).toEqual(before);
  });

  test("400 without confirm, 428 without If-Match, 412 after a hand edit of settings", async () => {
    const noConfirm = await send("PUT", "/api/policy", BALANCED);
    expect(noConfirm.status).toBe(400);
    expect(await error(noConfirm)).toContain('"confirm": true');
    expect((await send("PUT", "/api/policy", { ...BALANCED, confirm: true }, { match: null })).status).toBe(428);
    const { etag } = (await (await preview()).json()) as PolicyPreview;
    writeFileSync(settingsFile(), JSON.stringify({ ...JSON.parse(text(settingsFile())), theme: "dark" }));
    const stale = await send("PUT", "/api/policy", { ...BALANCED, confirm: true }, { match: etag });
    expect(stale.status).toBe(412);
    expect(text(configPath())).not.toContain('"policy"');
  });

  test("project scope at an installed git root writes settings.local.json", async () => {
    const repo = join(ctx.home, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    process.chdir(repo);
    await quiet(["install", "--scope", "project"]);
    const res = await put({ preset: "strict", scope: "project" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PolicyWriteResult).policy.settings_path).toBe(join(realpathSync(repo), ".claude", "settings.local.json"));
  });

  test("CSRF set: no token, foreign Origin, cross-site fetch → 403; text/plain → 415; nothing written", async () => {
    const before = text(settingsFile());
    const bad = [
      [{ "x-cm-token": "" }, 403],
      [{ origin: "https://evil.example" }, 403],
      [{ "sec-fetch-site": "cross-site" }, 403],
      [{ "content-type": "text/plain" }, 415],
    ] as const;
    for (const [headers, status] of bad) {
      expect((await send("PUT", "/api/policy", { ...BALANCED, confirm: true }, { headers })).status).toBe(status);
    }
    expect(text(settingsFile())).toBe(before);
  });
});

describe("PATCH /api/policy/rows/:row", () => {
  test("200 sets an override and re-applies: snapshot changes, settings bytes don't", async () => {
    await put();
    const settings = text(settingsFile());
    const res = await send("PATCH", "/api/policy/rows/coder", { shell: "allow", git: "allow" });
    expect(res.status).toBe(200);
    const r = (await res.json()) as PolicyWriteResult;
    expect(r.policy.rows.find((x) => x.row === "coder")!.cells.shell).toEqual({ decision: "allow", source: "override" });
    expect(r.changes.filter((c) => c.op === "add" || c.op === "remove")).toEqual([]);
    expect(text(settingsFile())).toBe(settings);
    expect(JSON.parse(text(policySnapshotPath())).matrix.coder.shell).toBe("allow");
    expect(JSON.parse(text(configPath())).policy.overrides).toEqual({ coder: { shell: "allow", git: "allow" } });
  });

  test("400 push allow / bad capability / bad decision / empty body; 404 unknown row", async () => {
    await put();
    const cases = [
      [{ push: "allow" }, "push is owner-only; use ask or deny"],
      [{ fly: "allow" }, 'unknown capability "fly"'],
      [{ edit: "maybe" }, 'bad decision "maybe"'],
      [{}, "capability → decision"],
    ] as const;
    for (const [body, msg] of cases) {
      const res = await send("PATCH", "/api/policy/rows/coder", body);
      expect(res.status).toBe(400);
      expect(await error(res)).toContain(msg);
    }
    const missing = await send("PATCH", "/api/policy/rows/ghost", { edit: "ask" });
    expect(missing.status).toBe(404);
  });

  test("409 before set up, 428 without If-Match, 412 on a stale etag", async () => {
    expect((await send("PATCH", "/api/policy/rows/coder", { edit: "ask" })).status).toBe(409);
    await put();
    expect((await send("PATCH", "/api/policy/rows/coder", { edit: "ask" }, { match: null })).status).toBe(428);
    const { etag } = (await get()).body;
    expect((await send("PATCH", "/api/policy/rows/coder", { edit: "deny" })).status).toBe(200);
    expect((await send("PATCH", "/api/policy/rows/coder", { edit: "ask" }, { match: etag })).status).toBe(412);
  });
});

describe("DELETE /api/policy", () => {
  test("200 disables: settings back to the install bytes, snapshot removed, matrix kept; PATCH still works", async () => {
    const installed = text(settingsFile());
    await put();
    await send("PATCH", "/api/policy/rows/coder", { shell: "allow" });
    const res = await send("DELETE", "/api/policy");
    expect(res.status).toBe(200);
    const r = (await res.json()) as PolicyWriteResult;
    expect(r.policy.status).toBe("disabled");
    expect(text(settingsFile())).toBe(installed);
    expect(existsSync(policySnapshotPath())).toBe(false);
    expect(JSON.parse(text(configPath())).policy).toMatchObject({ enabled: false, overrides: { coder: { shell: "allow" } } });
    expect((await send("PATCH", "/api/policy/rows/coder", { edit: "ask" }, { match: r.etag })).status).toBe(200);
  });

  test("409 before set up, 428 without If-Match, 412 on a stale etag", async () => {
    expect((await send("DELETE", "/api/policy")).status).toBe(409);
    await put();
    expect((await send("DELETE", "/api/policy", undefined, { match: null })).status).toBe(428);
    expect((await send("DELETE", "/api/policy", undefined, { match: "0".repeat(64) })).status).toBe(412);
    expect(JSON.parse(text(configPath())).policy.enabled).toBe(true);
  });
});

describe("GET /api/policy/audit", () => {
  const line = (i: number, role: string, decision: string, tool = "Bash") =>
    JSON.stringify({ ts: new Date(Date.now() - i * 60_000).toISOString(), session_id: `s${i}`, agent_id: "a1", role, tool, cap: "shell", decision, rule: `role:${role}.shell`, mode: "default" });

  // The API no longer ingests on demand (the dashboard sync loop does), so ingest here as a sync tick would.
  beforeEach(async () => {
    mkdirSync(ctx.app, { recursive: true });
    const lines = [...Array.from({ length: 5 }, (_, i) => line(i, "coder", "allow")), line(5, "coder", "deny", "Edit"), line(6, "reviewer", "ask")];
    appendFileSync(policyAuditPath(), `${lines.join("\n")}\n`);
    await ingestPolicyAudit(db);
  });

  test("does not ingest on read: lines appended after the last sync wait for the next tick", async () => {
    appendFileSync(policyAuditPath(), `${line(9, "coder", "allow")}\n`);
    expect((await get<AuditResponse>("/api/policy/audit")).body.total).toBe(7);
    await ingestPolicyAudit(db);
    expect((await get<AuditResponse>("/api/policy/audit")).body.total).toBe(8);
  });

  test("paginates newest first, facets count every row, never returns agent_id", async () => {
    const { res, body } = await get<AuditResponse>("/api/policy/audit?size=3&page=2", RO);
    expect(res.status).toBe(200);
    expect(body.total).toBe(7);
    expect(body.page).toBe(2);
    expect(body.size).toBe(3);
    expect(body.items.map((r) => r.session_id)).toEqual(["s3", "s4", "s5"]);
    expect(body.items[0]).not.toHaveProperty("agent_id");
    expect(body.items.every((r) => /^[0-9a-f]+$/.test(r.id))).toBe(true);
    expect(new Set(body.items.map((r) => r.id)).size).toBe(3);
    expect(body.facets.role).toEqual([{ value: "coder", count: 6 }, { value: "reviewer", count: 1 }]);
    expect(body.facets.decision).toContainEqual({ value: "deny", count: 1 });
  });

  test("filters by role, decision, tool and q; default size 50; summary shows in GET /api/policy", async () => {
    const coderDeny = (await get<AuditResponse>("/api/policy/audit?role=coder&decision=deny")).body;
    expect(coderDeny.total).toBe(1);
    expect(coderDeny.size).toBe(50);
    expect((await get<AuditResponse>("/api/policy/audit?tool=Bash")).body.total).toBe(6);
    expect((await get<AuditResponse>("/api/policy/audit?q=reviewer")).body.total).toBe(1);
    const cap = (await get<AuditResponse>("/api/policy/audit?cap=shell&cap=edit")).body;
    expect(cap.total).toBe(7);
    expect((await get<AuditResponse>("/api/policy/audit?cap=edit")).body.total).toBe(0);
    expect(cap.facets.capability).toEqual([{ value: "shell", count: 7 }]);
    expect((await get()).body.audit_summary).toContainEqual({ role: "coder", decision: "allow", count: 5 });
  });

  test("400 on size > 100, page 0 and a bad since", async () => {
    for (const q of ["size=101", "page=0", "since=yesterday"]) {
      expect((await get(`/api/policy/audit?${q}`)).res.status).toBe(400);
    }
  });
});
