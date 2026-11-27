// Writes synthetic, deterministic Claude Code transcripts for dashboard demos and UI audits. Never reads real logs.
// Usage: bun scripts/seed.demo.ts <claude-config-dir>   (e.g. $T/.claude, then run the dashboard with CLAUDE_CONFIG_DIR=$T/.claude)
// Shape follows src/ingest/ingest.parser.ts and the fixtures in test/dashboard.test.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HEAVY_ROLES, LONG_TITLE, MODEL, type ModelKey, PROJECTS, PROMPTS, ROLE_MODELS, TITLES, TOOLS } from "./seed.demo.data.ts";

const SEED = 0x5eed;
const DAYS = 30;
const SESSIONS = 124;
/** Sessions in the 30 days before the window, so "vs previous period" deltas have data. */
const PREV_SESSIONS = 8;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const WINDOW_200K = 200_000;
const CODER_REQUESTED = "claude-sonnet-5-5";

const root = process.argv[2];
if (!root) {
  console.error("usage: bun scripts/seed.demo.ts <claude-config-dir>");
  process.exit(1);
}
const projectsDir = join(root, "projects");
rmSync(projectsDir, { recursive: true, force: true }); // rerun = same output, no stale files

// mulberry32: tiny seeded PRNG so every run produces the same data shape.
let state = SEED;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;

interface Spec { sid: string; project: (typeof PROJECTS)[number]; start: number; model: ModelKey; mid: string; turns: number; titled: boolean; title?: string; manager: boolean; ctxStart: number; ctxGrowth: number }

let seq = 0;
const lines = new Map<string, string[]>();
const metas = new Map<string, Record<string, unknown>>();
function emit(path: string, entry: Record<string, unknown>) {
  if (!lines.has(path)) lines.set(path, []);
  lines.get(path)!.push(JSON.stringify(entry));
}
const fileFor = (cwd: string, sid: string, agent?: string) =>
  join(projectsDir, cwd.replaceAll("/", "-"), ...(agent ? [sid, "subagents", `agent-${agent}.jsonl`] : [`${sid}.jsonl`]));

const base = (s: Spec, ts: number, branch: string) => ({
  sessionId: s.sid, timestamp: new Date(ts).toISOString(), uuid: `u-${++seq}-${hex(6)}`, cwd: s.project.cwd, gitBranch: branch, version: "2.5.4",
});
/** One assistant request; context = input + cache_read + cache_write, matching dashboard.repository CONTEXT. */
function usage(context: number, fresh = false) {
  const write = fresh ? Math.round(context * 0.9) : int(800, 6000);
  const input = int(3, 40);
  return { input_tokens: input, cache_read_input_tokens: Math.max(0, context - write - input), cache_creation_input_tokens: write, output_tokens: int(150, 2800) };
}
/** Final replies: mostly end_turn, with a tail of max_tokens / stop_sequence / refusal. */
function endReason(): string {
  const r = rand();
  return r < 0.05 ? "max_tokens" : r < 0.09 ? "stop_sequence" : r < 0.1 ? "refusal" : "end_turn";
}
/** Tool-call block: a random non-Agent tool 70% of the time (else a plain reply). */
const toolBlock = () => {
  if (rand() > 0.7) return [];
  const t = pick(TOOLS);
  return [{ type: "tool_use", id: `toolu_${hex(20)}`, name: t.name, input: t.input }];
};
/** `requested` = the model the client asked for; differs from `model` when a gateway reroutes the request. */
const assistant = (model: string, u: Record<string, number>, content: unknown[] = [], requested = model) => {
  const id = `msg_${hex(20)}`;
  return { type: "assistant", requestedModel: requested, requestId: `req_${hex(16)}`, message: { id, model, usage: u, content, stop_reason: content.length ? "tool_use" : endReason() } };
};
const prompt = (text: string) => ({ type: "user", promptSource: "typed", message: { role: "user", content: text } });

/** Subagent transcript + .meta.json; may spawn one nested reviewer (depth 2). Returns ms spent. */
function subagent(s: Spec, ts: number, branch: string, role: string, toolUseId: string, depth: number): number {
  const agentId = hex(17);
  const path = fileFor(s.project.cwd, s.sid, agentId);
  const heavy = HEAVY_ROLES.includes(role) && rand() < 0.6;
  const sc = { isSidechain: true, agentId };
  emit(path, { ...base(s, ts, branch), ...sc, ...prompt(`${role}: ${pick(PROMPTS)}`) });
  const steps = heavy ? int(220, 420) : int(2, 7);
  let t = ts;
  let ctx = heavy ? int(700_000, 900_000) : int(12_000, 30_000);
  for (let i = 0; i < steps; i++) {
    t += heavy ? int(1, 3) * 1000 : int(8, 60) * 1000;
    const model = pick(ROLE_MODELS[role] ?? ROLE_MODELS["general-purpose"]!); // a role is served by a mix of models
    const nest = role === "coder" && depth === 1 && i === steps - 1 && rand() < 0.5;
    const tu = `toolu_${hex(20)}`;
    // Demo gateway: coder asks for sonnet but opus answers part of the time (shows the "rerouted" badge).
    const requested = role === "coder" && model.includes("opus") ? CODER_REQUESTED : model;
    emit(path, { ...base(s, t, branch), ...sc, ...assistant(model, usage(ctx, i === 0), nest ? [{ type: "tool_use", id: tu, name: "Agent", input: { subagent_type: "reviewer" } }] : toolBlock(), requested) });
    if (nest) t += subagent(s, t + 1000, branch, "reviewer", tu, 2);
    ctx += heavy ? int(1_000, 3_000) : int(2_000, 9_000);
  }
  metas.set(path.replace(/\.jsonl$/, ".meta.json"), { agentType: role, description: `${role} task for ${s.project.cwd.split("/").pop()}`, toolUseId, spawnDepth: depth });
  return t - ts;
}

/** Main transcript: prompts, growing context, optional manager subagent fan-out. Returns last timestamp. */
function session(s: Spec): number {
  const path = fileFor(s.project.cwd, s.sid);
  const branch = pick(s.project.branch);
  let t = s.start;
  let ctx = s.ctxStart;
  if (s.manager) emit(path, { type: "agent-setting", agentSetting: "manager", sessionId: s.sid });
  for (let turn = 0; turn < s.turns; turn++) {
    emit(path, { ...base(s, t, branch), ...prompt(pick(PROMPTS)) });
    const calls = int(1, 4);
    for (let c = 0; c < calls; c++) {
      t += int(5, 90) * 1000;
      const spawnRole = s.manager && c === 0 && rand() < 0.6 ? pick(Object.keys(ROLE_MODELS)) : null;
      const tu = `toolu_${hex(20)}`;
      const content = spawnRole ? [{ type: "tool_use", id: tu, name: "Agent", input: { subagent_type: spawnRole } }] : toolBlock();
      emit(path, { ...base(s, t, branch), ...assistant(s.mid, usage(ctx, turn === 0 && c === 0), content) });
      if (spawnRole) t += subagent(s, t + 1000, branch, spawnRole, tu, 1);
      ctx += s.ctxGrowth;
    }
    t += int(1, 12) * MIN;
  }
  if (s.titled) emit(path, { type: "ai-title", sessionId: s.sid, aiTitle: s.title ?? pick(TITLES) });
  return t;
}

const weighted = PROJECTS.flatMap((p) => Array<typeof p>(p.weight).fill(p));
const now = Date.now();
function spec(start: number, over: Partial<Spec> = {}): Spec {
  const model: ModelKey = rand() < 0.45 ? "opus" : rand() < 0.75 ? "sonnet" : "haiku";
  return {
    sid: uuid(), project: pick(weighted), start, model, mid: pick(MODEL[model]), turns: int(2, 9), titled: rand() < 0.85, manager: rand() < 0.35,
    ctxStart: int(14_000, 28_000), ctxGrowth: int(1_500, 6_000), ...over,
  };
}

const specs: Spec[] = [];
for (let i = 0; i < SESSIONS; i++) specs.push(spec(now - DAYS * DAY + Math.floor(rand() * (DAYS - 1) * DAY)));
for (let i = 0; i < PREV_SESSIONS; i++) specs.push(spec(now - 2 * DAYS * DAY + Math.floor(rand() * (DAYS - 1) * DAY)));
Object.assign(specs[0]!, { titled: true, title: LONG_TITLE });
for (const s of specs.slice(1, 6)) s.titled = false; // a few untitled sessions
for (const s of specs) {
  // Keep 200k-window models under their window so the context estimate stays at 200k (see context.window.ts).
  if (s.model !== "opus") s.ctxGrowth = Math.min(s.ctxGrowth, Math.floor((WINDOW_200K * 0.8 - s.ctxStart) / (s.turns * 4)));
  session(s);
}

// Live (<5 min since last request), idle (5-15 min) and context-level cases. Ages are relative to `now` and kept
// well inside each band so the status still holds a few minutes after seeding.
const LIVE_STEP_MIN = 10;
function live(over: Partial<Spec>, lastAgoMin: number, finalContext: number, titled = true) {
  const s = spec(0, over);
  s.mid = pick(MODEL[s.model]);
  const path = fileFor(s.project.cwd, s.sid);
  const branch = s.project.branch[0]!;
  const fractions = [0.55, 0.7, 0.82, 1];
  fractions.forEach((f, i) => {
    const reply = now - (lastAgoMin + (fractions.length - 1 - i) * LIVE_STEP_MIN) * MIN; // last reply = lastAgoMin ago
    emit(path, { ...base(s, reply - 30_000, branch), ...prompt(pick(PROMPTS)) });
    emit(path, { ...base(s, reply, branch), ...assistant(s.mid, usage(Math.round(finalContext * f), i === 0), toolBlock()) });
  });
  if (titled) emit(path, { type: "ai-title", sessionId: s.sid, aiTitle: pick(TITLES) });
}
const P = (i: number) => PROJECTS[i]!;
// Live: danger (92%), warn (78%), ok (32%) on 200k-window models.
live({ model: "sonnet", project: P(0) }, 0.5, Math.round(WINDOW_200K * 0.92));
live({ model: "haiku", project: P(7) }, 1.5, Math.round(WINDOW_200K * 0.78));
live({ model: "sonnet", project: P(1) }, 3, 64_000);
live({ model: "opus", project: P(4) }, 4, 180_000, false); // 1M window: still comfortable
// Idle: 5-15 min.
live({ model: "sonnet", project: P(2) }, 7, Math.round(WINDOW_200K * 0.9));
live({ model: "haiku", project: P(6) }, 10, Math.round(WINDOW_200K * 0.72));
live({ model: "opus", project: P(3) }, 12, 120_000);
const LIVE_COUNT = 7;

for (const [path, ls] of lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${ls.join("\n")}\n`);
}
for (const [path, meta] of metas) writeFileSync(path, JSON.stringify(meta));
const agents = metas.size;
console.log(`seed.demo: ${specs.length + LIVE_COUNT} sessions, ${agents} subagents, ${PROJECTS.length} projects → ${projectsDir}`);
