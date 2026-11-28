import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { openDb } from "../src/db/db.schema.ts";
import { formatSync } from "../src/commands/sync.command.ts";
import { recordSync } from "../src/commands/dashboard.command.ts";
import type { SyncMeta } from "../src/server/dashboard.types.ts";
import { sync } from "../src/ingest/ingest.service.ts";
import { policyAuditPath } from "../src/ingest/policy.audit.ingest.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
let db: Database;
beforeEach(() => {
  db = openDb();
  mkdirSync(ctx.app, { recursive: true });
});
afterEach(() => db.close());

// test-only audit line shaped like the hook's (§2.7)
const line = (i: number) =>
  JSON.stringify({ ts: new Date(Date.now() - i * 1000).toISOString(), session_id: `s${i}`, agent_id: "a", role: "coder", tool: "Bash", cap: "shell", decision: "allow", rule: "role:coder.shell", mode: "default" });
const rows = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM policy_decisions").get()!.n;

test("sync ingests the policy audit, counts bad lines as a warning, and is idempotent", async () => {
  writeFileSync(policyAuditPath(), `${line(1)}\n${line(2)}\nnot json\n`);
  const r = await sync(db);
  expect(r.policyAudit).toMatchObject({ added: 2, badLines: 1 });
  expect(r.warnings).toEqual(["1 unparseable policy audit lines skipped"]);
  expect(rows()).toBe(2);
  expect((await sync(db)).policyAudit?.added).toBe(0);
  expect(rows()).toBe(2);
});

test("a broken audit file doesn't fail sync: the cause is a warning and transcripts still sync", async () => {
  mkdirSync(policyAuditPath()); // a directory where the file should be: reading it throws
  const r = await sync(db);
  expect(r.policyAudit).toBeNull();
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).toStartWith("policy audit not ingested: policy audit ingest ");
  expect(r.files).toBe(0);
});

test("sync warnings are printed by formatSync and surfaced in dashboard meta, then cleared on a clean tick", async () => {
  mkdirSync(policyAuditPath());
  const r = await sync(db);
  expect(formatSync(r)).toContain(`warning: ${r.warnings[0]}`);
  const meta: SyncMeta = { synced_at: null, changed_at: null, error: null, warnings: [], interval_ms: 1 };
  recordSync(meta, r);
  expect(meta.warnings).toEqual(r.warnings);
  recordSync(meta, { ...r, warnings: [] });
  expect(meta.warnings).toEqual([]);
  expect(meta.changed_at).toBeNull();
  recordSync(meta, { ...r, policyAudit: { added: 2, badLines: 0 } as never });
  expect(meta.changed_at).toBe(meta.synced_at);
});
