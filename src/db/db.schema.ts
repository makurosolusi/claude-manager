import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "../app.paths.ts";

/** One migration step: SQL, or code when it needs a conditional SQLite cannot express (no ADD COLUMN IF NOT EXISTS). */
type Migration = string | ((db: Database) => void);

// Append-only: entry i migrates user_version i -> i+1. Never edit a shipped entry.
const MIGRATIONS: Migration[] = [
  `
  CREATE TABLE files (
    path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, ino INTEGER NOT NULL,
    offset INTEGER NOT NULL, bad_lines INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, project_cwd TEXT, git_branch TEXT, title TEXT, main_agent TEXT,
    first_ts TEXT, last_ts TEXT, version TEXT, cc_cost_usd REAL
  );
  CREATE TABLE agents (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_type TEXT, description TEXT,
    tool_use_id TEXT, spawn_depth INTEGER
  );
  CREATE TABLE requests (
    message_id TEXT PRIMARY KEY, request_id TEXT, session_id TEXT NOT NULL, agent_id TEXT, ts TEXT NOT NULL,
    model TEXT NOT NULL, effort TEXT, speed TEXT, geo TEXT,
    input INTEGER NOT NULL, cache_5m INTEGER NOT NULL, cache_1h INTEGER NOT NULL, cache_read INTEGER NOT NULL,
    output INTEGER NOT NULL, thinking INTEGER NOT NULL, web_search INTEGER NOT NULL,
    cost_usd REAL /* NULL = model has no known rates */, pricing_version TEXT NOT NULL, stop_reason TEXT, is_sidechain INTEGER NOT NULL
  );
  CREATE INDEX requests_session ON requests(session_id, ts);
  CREATE INDEX requests_ts ON requests(ts);
  CREATE INDEX requests_agent ON requests(agent_id);
  CREATE TABLE prompts (
    uuid TEXT PRIMARY KEY, prompt_id TEXT, session_id TEXT NOT NULL, agent_id TEXT, ts TEXT NOT NULL,
    source TEXT, text TEXT
  );
  CREATE INDEX prompts_session ON prompts(session_id, ts);
  CREATE TABLE tool_calls (
    tool_use_id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT,
    ts TEXT NOT NULL, name TEXT NOT NULL, subagent_type TEXT, model TEXT
  );
  CREATE INDEX tool_calls_message ON tool_calls(message_id);
  CREATE TABLE compactions (
    uuid TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT, ts TEXT NOT NULL,
    trigger TEXT, pre_tokens INTEGER, post_tokens INTEGER
  );
  `,
  `
  -- v0.2.0: new filters/facets scan sessions by last_ts/project and count agents/tools per session; without these each is a full scan.
  CREATE INDEX IF NOT EXISTS sessions_last_ts ON sessions(last_ts);
  CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_cwd, last_ts);
  CREATE INDEX IF NOT EXISTS agents_session ON agents(session_id);
  CREATE INDEX IF NOT EXISTS tool_calls_session ON tool_calls(session_id, name);
  `,
  (db) => {
    // v0.2.1: a gateway can serve another model than the one asked for; `requested_model` (NULL = unknown, never guessed) lets the dashboard flag it.
    const has = db.query("SELECT 1 FROM pragma_table_info('requests') WHERE name = 'requested_model'").get();
    if (!has) db.run("ALTER TABLE requests ADD COLUMN requested_model TEXT");
    // Backfill: ingest is incremental by offset, so old lines are never re-read. A bogus inode makes the next sync treat every
    // file as replaced and re-read it from 0 (inserts are idempotent; the upsert only fills a NULL requested_model).
    db.run("UPDATE files SET ino = -1");
  },
];

/** Opens (and migrates) the analytics DB; file is owner-only since it may hold prompt text. */
export function openDb(path = dbPath()): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  chmodSync(path, 0o600);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");
  const current = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`data.db schema v${current} is newer than this claude-manager (v${MIGRATIONS.length}); upgrade the binary`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      const step = MIGRATIONS[v]!;
      if (typeof step === "string") db.run(step);
      else step(db);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return db;
}
