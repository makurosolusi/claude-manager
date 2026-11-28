import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "../src/app.paths.ts";
import { auditPage, auditSummary } from "../src/db/policy.repository.ts";
import { openDb } from "../src/db/db.schema.ts";
import { ingestPolicyAudit, policyAuditPath } from "../src/ingest/policy.audit.ingest.ts";
import { useTempHome } from "./test.home.ts";

useTempHome();

const NOW = Date.parse("2026-11-28T12:00:00Z");
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
// test-only fixture event
const ev = (o: Partial<Record<string, unknown>> = {}) =>
  JSON.stringify({ ts: iso(1), session_id: "s1", agent_id: "a1", role: "coder", tool: "Edit", cap: "edit", decision: "allow", rule: "role:coder.edit", mode: "default", ...o });
const append = (path: string, ...lines: string[]) => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lines.map((l) => l + "\n").join(""));
};
const count = (db: Database) => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM policy_decisions").get()!.n;
const page = { page: 1, pageSize: 50 };
const run = (db: Database, o = {}) => ingestPolicyAudit(db, { now: NOW, ...o });

describe("migration 4", () => {
  test("is idempotent and upgrades a v3 DB", () => {
    mkdirSync(dirname(dbPath()), { recursive: true });
    const db = openDb();
    db.run("DROP TABLE policy_decisions");
    db.run("PRAGMA user_version = 3");
    db.close();
    for (let i = 0; i < 2; i++) {
      const again = openDb();
      expect(again.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(4);
      expect(count(again)).toBe(0);
      again.close();
    }
  });

  test("table has no input/path/command columns", () => {
    const db = openDb();
    const cols = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('policy_decisions')").all().map((c) => c.name);
    expect(cols.sort()).toEqual(["agent_id", "cap", "decision", "line_hash", "mode", "role", "rule", "session_id", "tool", "ts"]);
    for (const bad of ["tool_input", "input", "path", "command", "cwd", "prompt", "url"]) expect(cols).not.toContain(bad);
  });
});

describe("ingest", () => {
  test("re-ingest adds nothing; appended lines are picked up", async () => {
    const db = openDb();
    append(policyAuditPath(), ev({ ts: iso(3) }), ev({ ts: iso(2), decision: "deny", rule: "secret" }));
    expect((await run(db)).added).toBe(2);
    expect((await run(db)).added).toBe(0);
    append(policyAuditPath(), ev({ ts: iso(1) }));
    expect((await run(db)).added).toBe(1);
    expect(count(db)).toBe(3);
  });

  test("a forced full re-read (new inode, same content) is deduped by hash", async () => {
    const db = openDb();
    append(policyAuditPath(), ev({ ts: iso(3) }), ev({ ts: iso(2) }));
    await run(db);
    db.run("UPDATE files SET ino = -1");
    expect((await run(db)).added).toBe(0);
    expect(count(db)).toBe(2);
  });

  test("malformed lines are skipped and counted; extra fields are never stored", async () => {
    const db = openDb();
    append(
      policyAuditPath(),
      "not json",
      "[1,2]",
      ev({ decision: "maybe" }),
      ev({ ts: "yesterday" }),
      ev({ role: undefined }),
      ev({ tool_input: { command: "ls -la /secret" }, cwd: "/home/x", ts: iso(2) }),
    );
    const r = await run(db);
    expect(r.badLines).toBe(5);
    expect(r.added).toBe(1);
    expect(JSON.stringify(db.query("SELECT * FROM policy_decisions").all())).not.toMatch(/ls -la|\/secret|\/home\/x/);
  });

  test("a partial trailing line waits for its newline", async () => {
    const db = openDb();
    const p = policyAuditPath();
    append(p, ev({ ts: iso(3) }));
    appendFileSync(p, ev({ ts: iso(2) }).slice(0, 20));
    expect((await run(db)).added).toBe(1);
    appendFileSync(p, ev({ ts: iso(2) }).slice(20) + "\n");
    const r = await run(db);
    expect(r.added).toBe(1);
    expect(r.badLines).toBe(0);
  });

  test("rotation at the size threshold loses and duplicates nothing", async () => {
    const db = openDb();
    const p = policyAuditPath();
    append(p, ev({ ts: iso(5) }), ev({ ts: iso(4) }));
    const rotateBytes = statSync(p).size;
    expect(await run(db, { rotateBytes })).toMatchObject({ added: 2, rotated: true });
    expect(await Bun.file(p).exists()).toBe(false); // renamed away
    expect(await Bun.file(`${p}.1`).exists()).toBe(true);
    // the hook starts a new live file; the next sync reads it without re-adding .1
    append(p, ev({ ts: iso(3) }));
    expect((await run(db, { rotateBytes: 1e9 })).added).toBe(1);
    expect(count(db)).toBe(3);
    expect((await run(db, { rotateBytes: 1e9 })).added).toBe(0);
  });

  test("events that landed in the old file before its rename are read from .1", async () => {
    const db = openDb();
    const p = policyAuditPath();
    append(p, ev({ ts: iso(5) }));
    await run(db, { rotateBytes: 1e9 });
    writeFileSync(`${p}.1`, ev({ ts: iso(5) }) + "\n" + ev({ ts: iso(4) }) + "\n");
    expect((await run(db, { rotateBytes: 1e9 })).added).toBe(1);
    expect(count(db)).toBe(2);
  });
});

describe("retention", () => {
  test("drops rows older than 30 days", async () => {
    const db = openDb();
    const stale = new Date(NOW - 31 * 86_400_000).toISOString();
    append(policyAuditPath(), ev({ ts: stale }), ev({ ts: iso(1) }));
    await run(db);
    expect(count(db)).toBe(1);
    // rows that age out after being stored are pruned too
    expect((await run(db, { now: NOW + 31 * 86_400_000 })).pruned).toBe(1);
    expect(count(db)).toBe(0);
  });

  test("caps rows, keeping the newest", async () => {
    const db = openDb();
    append(policyAuditPath(), ...[5, 4, 3, 2, 1].map((m) => ev({ ts: iso(m), rule: `r${m}` })));
    const r = await run(db, { maxRows: 2 });
    expect(r.pruned).toBe(3);
    expect(db.query<{ rule: string }, []>("SELECT rule FROM policy_decisions ORDER BY ts").all().map((x) => x.rule)).toEqual(["r2", "r1"]);
  });
});

describe("repository", () => {
  async function seeded() {
    const db = openDb();
    append(
      policyAuditPath(),
      ev({ ts: iso(10), role: "coder", tool: "Edit", cap: "edit", decision: "allow", rule: "role:coder.edit" }),
      ev({ ts: iso(9), role: "coder", tool: "Bash", cap: "git", decision: "ask", rule: "owner-only:push" }),
      ev({ ts: iso(8), role: "coder", tool: "Bash", cap: "git", decision: "deny", rule: "secret" }),
      ev({ ts: iso(7), role: "reviewer", tool: "Read", cap: "read", decision: "allow", rule: "role:reviewer.read" }),
      ev({ ts: iso(6), role: "reviewer", tool: "mcp__github", cap: null, decision: "deny", rule: "role:reviewer.mcp" }),
    );
    await run(db);
    return db;
  }

  test("facet counts are correct and ignore their own filter", async () => {
    const db = await seeded();
    const all = auditPage(db, {}, page);
    expect(all.total).toBe(5);
    expect(all.facets.decision).toEqual([{ value: "allow", count: 2 }, { value: "deny", count: 2 }, { value: "ask", count: 1 }]);
    expect(all.facets.role).toEqual([{ value: "coder", count: 3 }, { value: "reviewer", count: 2 }]);
    expect(all.facets.capability.find((c) => c.value === "git")?.count).toBe(2);
    const coder = auditPage(db, { roles: ["coder"] }, page);
    expect(coder.total).toBe(3);
    expect(coder.facets.role).toEqual([{ value: "coder", count: 3 }, { value: "reviewer", count: 2 }]);
    expect(coder.facets.decision.find((d) => d.value === "deny")?.count).toBe(1);
  });

  test("search covers role, tool and rule; sorted newest first", async () => {
    const db = await seeded();
    expect(auditPage(db, { q: "OWNER-ONLY" }, page).total).toBe(1);
    expect(auditPage(db, { q: "mcp__github" }, page).total).toBe(1);
    expect(auditPage(db, { q: "reviewer" }, page).total).toBe(2);
    const rows = auditPage(db, {}, page).items.map((r) => r.ts);
    expect(rows).toEqual([...rows].sort().reverse());
  });

  test("pagination totals and slices", async () => {
    const db = await seeded();
    const p1 = auditPage(db, {}, { page: 1, pageSize: 2 });
    const p3 = auditPage(db, {}, { page: 3, pageSize: 2 });
    expect([p1.items.length, p1.total, p3.items.length, p3.total]).toEqual([2, 5, 1, 5]);
    expect(auditPage(db, { decisions: ["deny"], since: iso(7.5) }, page).total).toBe(1);
  });

  test("summary counts per role and decision within the window", async () => {
    const db = await seeded();
    expect(auditSummary(db, iso(100))).toEqual([
      { role: "coder", decision: "allow", count: 1 },
      { role: "coder", decision: "ask", count: 1 },
      { role: "coder", decision: "deny", count: 1 },
      { role: "reviewer", decision: "allow", count: 1 },
      { role: "reviewer", decision: "deny", count: 1 },
    ]);
    expect(auditSummary(db, iso(8.5)).reduce((n, r) => n + r.count, 0)).toBe(3);
  });
});
