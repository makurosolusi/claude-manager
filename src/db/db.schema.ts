import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "../app.paths.ts";

// Append-only: entry i migrates user_version i -> i+1. Never edit a shipped entry.
const MIGRATIONS = [
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
      db.run(MIGRATIONS[v]!);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return db;
}
