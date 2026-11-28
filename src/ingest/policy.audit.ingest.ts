import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { appDir } from "../app.paths.ts";
import { readLines } from "./ingest.scanner.ts";

/** Rows older than this many days are dropped (decision 4 of the v0.4.0 spec). */
export const POLICY_AUDIT_DAYS = 30;
/** Hard cap on stored rows; the oldest go first. */
export const POLICY_AUDIT_MAX_ROWS = 200_000;
/** The live file is renamed to ".1" once fully read and at least this big. */
export const POLICY_AUDIT_ROTATE_BYTES = 5 * 1024 * 1024;

const DAY_MS = 86_400_000;
const FIELD_MAX = 200; // the hook caps every value well below this; guards a hand-edited file
const DECISIONS = new Set(["allow", "ask", "deny", "error"]);

export interface PolicyAuditOptions {
  maxRows?: number;
  days?: number;
  rotateBytes?: number;
  now?: number;
}

export interface PolicyAuditResult {
  /** Rows inserted by this call. */
  added: number;
  /** Lines that were not valid audit JSON (skipped, never fatal). */
  badLines: number;
  /** Rows removed by retention. */
  pruned: number;
  rotated: boolean;
}

/** Live audit file the hook appends to. */
export const policyAuditPath = () => join(appDir(), "policy-audit.jsonl");

const SQL = {
  file: "SELECT size, mtime_ms, ino, offset FROM files WHERE path = ?",
  saveFile: `INSERT INTO files (path, size, mtime_ms, ino, offset, bad_lines) VALUES ($path, $size, $mtime_ms, $ino, $offset, $bad)
    ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, ino = excluded.ino, offset = excluded.offset,
    bad_lines = CASE WHEN $reset THEN excluded.bad_lines ELSE files.bad_lines + excluded.bad_lines END`,
  insert: `INSERT OR IGNORE INTO policy_decisions (line_hash, ts, session_id, agent_id, role, tool, cap, decision, rule, mode)
    VALUES ($line_hash, $ts, $session_id, $agent_id, $role, $tool, $cap, $decision, $rule, $mode)`,
  byAge: "DELETE FROM policy_decisions WHERE ts < $cutoff",
  byCap: `DELETE FROM policy_decisions WHERE line_hash IN
    (SELECT line_hash FROM policy_decisions ORDER BY ts DESC, line_hash LIMIT -1 OFFSET $max)`,
};

// Valid non-empty string, null when an optional field is absent, undefined when invalid.
const str = (v: unknown, required: boolean): string | null | undefined => {
  if (typeof v === "string" && v.length > 0 && v.length <= FIELD_MAX) return v;
  return v === undefined || v === null ? (required ? undefined : null) : undefined;
};

/** Whitelists the audit fields; anything else in the line (e.g. a stray tool_input) is dropped. undefined = invalid. */
function toRow(line: string) {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line);
  } catch {
    return undefined; // counted by the caller
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const ts = str(o.ts, true);
  const role = str(o.role, true);
  const tool = str(o.tool, true);
  const rule = str(o.rule, true);
  const decision = str(o.decision, true);
  const opt = { session_id: str(o.session_id, false), agent_id: str(o.agent_id, false), cap: str(o.cap, false), mode: str(o.mode, false) };
  if (!ts || !role || !tool || !rule || !decision || !DECISIONS.has(decision) || Number.isNaN(Date.parse(ts))) return undefined;
  if (Object.values(opt).includes(undefined)) return undefined;
  // undefined optionals were ruled out above
  return { ts, role, tool, rule, decision, session_id: opt.session_id!, agent_id: opt.agent_id!, cap: opt.cap!, mode: opt.mode! };
}

const hash = (line: string) => createHash("sha256").update(line).digest("hex").slice(0, 32);

type FileResult = { added: number; bad: number; size: number; done: boolean } | null;

/** Reads new complete lines of one file by byte offset; null when the file is absent. */
async function ingestFile(db: Database, path: string, cutoff: string): Promise<FileResult> {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  const prev = db.query<{ size: number; mtime_ms: number; ino: number; offset: number }, [string]>(SQL.file).get(path);
  const mtime = Math.trunc(st.mtimeMs);
  if (prev && prev.size === st.size && prev.mtime_ms === mtime && prev.ino === st.ino) return { added: 0, bad: 0, size: st.size, done: prev.offset === st.size };
  // Replaced (rotation gives a new inode) or truncated: start over; the line_hash key makes re-reads harmless.
  const reset = !prev || prev.ino !== st.ino || st.size < prev.offset;
  let added = 0;
  let bad = 0;
  db.run("BEGIN");
  try {
    const insert = db.query(SQL.insert);
    const offset = await readLines(path, reset ? 0 : prev!.offset, st.size, (line) => {
      const row = toRow(line);
      if (!row) {
        bad++;
        return;
      }
      if (row.ts < cutoff) return; // already expired; do not insert just to prune
      added += insert.run({ line_hash: hash(line), ...row }).changes;
    });
    db.query(SQL.saveFile).run({ path, size: st.size, mtime_ms: mtime, ino: st.ino, offset, bad, reset: reset ? 1 : 0 });
    db.run("COMMIT");
    return { added, bad, size: st.size, done: offset === st.size };
  } catch (err) {
    db.run("ROLLBACK");
    throw new Error(`policy audit ingest ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/**
 * Entry point for sync: ingests policy-audit.jsonl.1 then policy-audit.jsonl incrementally and idempotently,
 * rotates the live file once fully read, then applies retention. Never throws on malformed lines.
 */
export async function ingestPolicyAudit(db: Database, opts: PolicyAuditOptions = {}): Promise<PolicyAuditResult> {
  const now = opts.now ?? Date.now();
  const cutoff = new Date(now - (opts.days ?? POLICY_AUDIT_DAYS) * DAY_MS).toISOString();
  const live = policyAuditPath();
  const old = `${live}.1`;
  const res: PolicyAuditResult = { added: 0, badLines: 0, pruned: 0, rotated: false };
  const take = (r: FileResult) => {
    res.added += r?.added ?? 0;
    res.badLines += r?.bad ?? 0;
    return r;
  };

  take(await ingestFile(db, old, cutoff));
  const r = take(await ingestFile(db, live, cutoff));
  if (r?.done && r.size >= (opts.rotateBytes ?? POLICY_AUDIT_ROTATE_BYTES)) {
    // Fully read, so nothing is lost by renaming. A hook append racing the rename lands in ".1" and is picked up below
    // (a new inode means a full re-read, deduped by line_hash). The hook recreates the live file on its next append.
    renameSync(live, old);
    res.rotated = true;
    // The overwritten ".1" may have shared an inode number with the new one; forget its offset so it is read from 0.
    db.query("DELETE FROM files WHERE path = ?").run(old);
    take(await ingestFile(db, old, cutoff));
  }

  res.pruned = db.query(SQL.byAge).run({ cutoff }).changes + db.query(SQL.byCap).run({ max: opts.maxRows ?? POLICY_AUDIT_MAX_ROWS }).changes;
  return res;
}
