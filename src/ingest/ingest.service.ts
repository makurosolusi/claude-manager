import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeDir } from "../app.paths.ts";
import { loadConfig } from "../config/config.store.ts";
import { readJson } from "../storage/json.file.ts";
import { isCandidate, parseEntry, type ParseContext, type RequestRow } from "./ingest.parser.ts";
import { listLogFiles, readLines, type LogFile } from "./ingest.scanner.ts";
import { loadPricing, ratesFor, requestCost, type Pricing } from "./pricing.service.ts";

export interface SyncResult {
  files: number;
  changed: number;
  newRequests: number;
  badLines: number;
  recomputed: number;
  /** Models seen without known rates (their cost is NULL). */
  unpriced: string[];
  ms: number;
}

type SessionAgg = {
  id: string;
  cwd: string | null;
  branch: string | null;
  version: string | null;
  first: string | null;
  last: string | null;
  title: string | null;
  mainAgent: string | null;
  ccCost: number | null;
}

interface AgentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
}

const SQL = {
  file: "SELECT size, mtime_ms, ino, offset FROM files WHERE path = ?",
  saveFile: `INSERT INTO files (path, size, mtime_ms, ino, offset, bad_lines) VALUES ($path, $size, $mtime_ms, $ino, $offset, $bad)
    ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, ino = excluded.ino, offset = excluded.offset,
    bad_lines = CASE WHEN $reset THEN excluded.bad_lines ELSE files.bad_lines + excluded.bad_lines END`,
  // Token fields take the latest streaming copy; session/agent keep the first file that saw the message
  // (resumed/forked transcripts copy old messages, which must not move their attribution).
  request: `INSERT INTO requests (message_id, request_id, session_id, agent_id, ts, model, requested_model, effort, speed, geo, input, cache_5m, cache_1h,
      cache_read, output, thinking, web_search, cost_usd, pricing_version, stop_reason, is_sidechain)
    VALUES ($message_id, $request_id, $session_id, $agent_id, $ts, $model, $requested_model, $effort, $speed, $geo, $input, $cache_5m, $cache_1h,
      $cache_read, $output, $thinking, $web_search, $cost_usd, $pricing_version, $stop_reason, $is_sidechain)
    ON CONFLICT(message_id) DO UPDATE SET input = excluded.input, cache_5m = excluded.cache_5m, cache_1h = excluded.cache_1h,
      cache_read = excluded.cache_read, output = excluded.output, thinking = excluded.thinking, web_search = excluded.web_search,
      cost_usd = excluded.cost_usd, pricing_version = excluded.pricing_version,
      stop_reason = COALESCE(excluded.stop_reason, requests.stop_reason),
      requested_model = COALESCE(excluded.requested_model, requests.requested_model)`,
  tool: `INSERT OR IGNORE INTO tool_calls (tool_use_id, message_id, session_id, agent_id, ts, name, subagent_type, model)
    VALUES ($tool_use_id, $message_id, $session_id, $agent_id, $ts, $name, $subagent_type, $model)`,
  prompt: `INSERT OR IGNORE INTO prompts (uuid, prompt_id, session_id, agent_id, ts, source, text)
    VALUES ($uuid, $prompt_id, $session_id, $agent_id, $ts, $source, $text)`,
  compaction: `INSERT OR IGNORE INTO compactions (uuid, session_id, agent_id, ts, trigger, pre_tokens, post_tokens)
    VALUES ($uuid, $session_id, $agent_id, $ts, $trigger, $pre_tokens, $post_tokens)`,
  session: `INSERT INTO sessions (id, project_cwd, git_branch, title, main_agent, first_ts, last_ts, version, cc_cost_usd)
    VALUES ($id, $cwd, $branch, $title, $mainAgent, $first, $last, $version, $ccCost)
    ON CONFLICT(id) DO UPDATE SET project_cwd = COALESCE(sessions.project_cwd, excluded.project_cwd),
      git_branch = COALESCE(excluded.git_branch, sessions.git_branch), title = COALESCE(excluded.title, sessions.title),
      main_agent = COALESCE(excluded.main_agent, sessions.main_agent), version = COALESCE(excluded.version, sessions.version),
      cc_cost_usd = COALESCE(excluded.cc_cost_usd, sessions.cc_cost_usd),
      first_ts = MIN(COALESCE(sessions.first_ts, excluded.first_ts), COALESCE(excluded.first_ts, sessions.first_ts)),
      last_ts = MAX(COALESCE(sessions.last_ts, excluded.last_ts), COALESCE(excluded.last_ts, sessions.last_ts))`,
  agent: `INSERT INTO agents (id, session_id, agent_type, description, tool_use_id, spawn_depth)
    VALUES ($id, $session_id, $agent_type, $description, $tool_use_id, $spawn_depth)
    ON CONFLICT(id) DO UPDATE SET agent_type = COALESCE(excluded.agent_type, agents.agent_type),
      description = COALESCE(excluded.description, agents.description),
      tool_use_id = COALESCE(excluded.tool_use_id, agents.tool_use_id), spawn_depth = COALESCE(excluded.spawn_depth, agents.spawn_depth)`,
};

const priced = (r: RequestRow, p: Pricing) => ({ ...r, cost_usd: requestCost(r, ratesFor(p.table, r.model)) ?? null, pricing_version: p.version });

function statOrSkip(path: string) {
  try {
    return statSync(path);
  } catch (err) {
    // Claude Code may delete a transcript between listing and stat.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`stat ${path}: ${(err as Error).message}`);
  }
}

async function ingestFile(db: Database, f: LogFile, pricing: Pricing, ctx: ParseContext): Promise<{ changed: boolean; bad: number }> {
  const st = statOrSkip(f.path);
  if (!st) return { changed: false, bad: 0 };
  const prev = db.query<{ size: number; mtime_ms: number; ino: number; offset: number }, [string]>(SQL.file).get(f.path);
  const mtime = Math.trunc(st.mtimeMs);
  if (prev && prev.size === st.size && prev.mtime_ms === mtime && prev.ino === st.ino) return { changed: false, bad: 0 };
  // Truncated or replaced file: start over (all inserts are idempotent).
  const reset = !prev || prev.ino !== st.ino || st.size < prev.offset;
  const start = reset ? 0 : prev.offset;

  const sessions = new Map<string, SessionAgg>();
  let bad = 0;
  db.run("BEGIN");
  try {
    const q = { request: db.query(SQL.request), tool: db.query(SQL.tool), prompt: db.query(SQL.prompt), compaction: db.query(SQL.compaction) };
    const offset = await readLines(f.path, start, st.size, (line) => {
      if (!isCandidate(line)) return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        bad++; // counted and surfaced by `sync`/`doctor`, never silently dropped
        return;
      }
      const p = parseEntry(entry, ctx);
      if (p.request) q.request.run(priced(p.request, pricing));
      for (const t of p.tools ?? []) q.tool.run(t);
      if (p.prompt) q.prompt.run(p.prompt);
      if (p.compaction) q.compaction.run(p.compaction);
      if (p.session) mergeSession(sessions, p.session);
    });
    for (const s of sessions.values()) db.query(SQL.session).run(s);
    if (f.agentId) await saveAgent(db, f);
    db.query(SQL.saveFile).run({ path: f.path, size: st.size, mtime_ms: mtime, ino: st.ino, offset, bad, reset: reset ? 1 : 0 });
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw new Error(`ingest ${f.path}: ${(err as Error).message}`, { cause: err });
  }
  return { changed: true, bad };
}

function mergeSession(map: Map<string, SessionAgg>, p: ReturnType<typeof parseEntry>["session"] & {}) {
  let s = map.get(p.id);
  if (!s) {
    s = { id: p.id, cwd: null, branch: null, version: null, first: null, last: null, title: null, mainAgent: null, ccCost: null };
    map.set(p.id, s);
  }
  s.cwd ??= p.cwd ?? null;
  s.branch = p.branch ?? s.branch;
  s.version = p.version ?? s.version;
  s.title = p.title ?? s.title;
  s.mainAgent = p.mainAgent ?? s.mainAgent;
  s.ccCost = p.ccCost ?? s.ccCost;
  if (p.ts) {
    if (!s.first || p.ts < s.first) s.first = p.ts;
    if (!s.last || p.ts > s.last) s.last = p.ts;
  }
}

async function saveAgent(db: Database, f: LogFile) {
  const meta = (await readJson<AgentMeta>(f.path.replace(/\.jsonl$/, ".meta.json"))) ?? {};
  db.query(SQL.agent).run({
    id: f.agentId!,
    session_id: f.sessionId,
    agent_type: meta.agentType ?? null,
    description: meta.description ?? null,
    tool_use_id: meta.toolUseId ?? null,
    spawn_depth: meta.spawnDepth ?? null,
  });
}

/** Re-prices rows stored under an older pricing table. */
function recompute(db: Database, pricing: Pricing): number {
  const stale = db.query<RequestRow, [string]>("SELECT * FROM requests WHERE pricing_version != ?").all(pricing.version);
  const update = db.query("UPDATE requests SET cost_usd = $cost_usd, pricing_version = $pricing_version WHERE message_id = $message_id");
  db.transaction(() => {
    for (const r of stale) {
      const { cost_usd, pricing_version } = priced(r, pricing);
      update.run({ cost_usd, pricing_version, message_id: r.message_id });
    }
  })();
  return stale.length;
}

const countRequests = (db: Database) => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM requests").get()!.n;

/** Incrementally ingests every Claude Code transcript into the analytics DB. */
export async function sync(db: Database): Promise<SyncResult> {
  const t0 = performance.now();
  const [pricing, config] = await Promise.all([loadPricing(), loadConfig()]);
  const root = join(claudeDir(), "projects");
  const files = existsSync(root) ? listLogFiles(root) : [];
  const before = countRequests(db);
  let changed = 0;
  let badLines = 0;
  for (const f of files) {
    const r = await ingestFile(db, f, pricing, { agentId: f.agentId, storePromptText: config.storePromptText });
    if (r.changed) changed++;
    badLines += r.bad;
  }
  const recomputed = recompute(db, pricing);
  const unpriced = db
    .query<{ model: string }, []>("SELECT DISTINCT model FROM requests WHERE cost_usd IS NULL ORDER BY model")
    .all()
    .map((r) => r.model);
  return { files: files.length, changed, newRequests: countRequests(db) - before, badLines, recomputed, unpriced, ms: Math.round(performance.now() - t0) };
}
