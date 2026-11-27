// Writes synthetic, deterministic Claude Code transcripts for dashboard demos and UI audits. Never reads real logs.
// Usage: bun scripts/seed.demo.ts <claude-config-dir>   (e.g. $T/.claude, then run the dashboard with CLAUDE_CONFIG_DIR=$T/.claude)
// Shape follows src/ingest/ingest.parser.ts and the fixtures in test/dashboard.test.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SEED = 0x5eed;
const DAYS = 30;
const SESSIONS = 40;
/** Sessions in the 30 days before the window, so "vs previous period" deltas have data. */
const PREV_SESSIONS = 8;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const WINDOW_200K = 200_000;

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

const MODEL = { opus: "claude-opus-4-7", sonnet: "claude-sonnet-4-5", haiku: "claude-haiku-4-5" } as const;
type ModelKey = keyof typeof MODEL;
/** Role → tier model, as in src/roles/roles.presets.ts (think=opus, work=sonnet, basic=haiku). */
const ROLE_MODEL: Record<string, ModelKey> = { architect: "opus", researcher: "haiku", coder: "sonnet", reviewer: "sonnet", writer: "haiku" };

// Two projects share the basename "web" on purpose: the UI must not rely on basename alone.
const PROJECTS = [
  { cwd: "/Users/dev/code/acme/api", branch: ["main", "feat/billing-v2", "fix/rate-limit"], weight: 5 },
  { cwd: "/Users/dev/code/acme/web", branch: ["main", "feat/onboarding"], weight: 4 },
  { cwd: "/Users/dev/code/side/web", branch: ["main"], weight: 2 },
  { cwd: "/Users/dev/code/acme/infra-terraform", branch: ["main", "chore/upgrade-provider"], weight: 2 },
  { cwd: "/Users/dev/code/oss/bun-sqlite-kit", branch: ["main"], weight: 2 },
  { cwd: "/Users/dev/notes/research-llm-evals", branch: ["main"], weight: 1 },
  { cwd: "/Users/dev/code/acme/mobile-app", branch: ["develop", "feat/push"], weight: 2 },
  { cwd: "/Users/dev/code/claude-manager", branch: ["main", "feature/m5-ui-polish"], weight: 3 },
];
const TITLES = [
  "Add Stripe webhook retry with idempotency keys", "Fix flaky login e2e test", "Refactor session store to Redis",
  "Migrate Terraform AWS provider to v6", "Investigate p95 latency spike on /search", "Write onboarding checklist component",
  "Add SQLite WAL checkpoint tuning", "Review PR #482 rate limiter", "Draft CHANGELOG for 2.3.0", "Implement push notification opt-in",
  "Explain eval harness scoring drift", "Split dashboard repository into modules", "Add pagination to /api/projects",
  "Debug CORS preflight on staging", "Port settings page to React 19", "Tighten CSP headers",
];
const PROMPTS = [
  "Look at the failing test and find the root cause before changing anything.", "Implement this and add a test.",
  "Can you review the diff for correctness bugs?", "Summarize what changed since yesterday.",
  "Plan the migration: files to touch, risks, order of work.", "Make the error message include the session id.",
  "Run the test suite and fix what breaks.", "Rename the module and update every import.",
];

interface Spec { sid: string; project: (typeof PROJECTS)[number]; start: number; model: ModelKey; turns: number; titled: boolean; manager: boolean; ctxStart: number; ctxGrowth: number }

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
const assistant = (model: string, u: Record<string, number>, content: unknown[] = []) => {
  const id = `msg_${hex(20)}`;
  return { type: "assistant", requestId: `req_${hex(16)}`, message: { id, model, usage: u, content, stop_reason: content.length ? "tool_use" : "end_turn" } };
};
const prompt = (text: string) => ({ type: "user", promptSource: "typed", message: { role: "user", content: text } });

/** Subagent transcript + .meta.json; may spawn one nested reviewer (depth 2). Returns ms spent. */
function subagent(s: Spec, ts: number, branch: string, role: string, toolUseId: string, depth: number): number {
  const agentId = hex(17);
  const path = fileFor(s.project.cwd, s.sid, agentId);
  const model = MODEL[ROLE_MODEL[role] ?? "sonnet"];
  const sc = { isSidechain: true, agentId };
  emit(path, { ...base(s, ts, branch), ...sc, ...prompt(`${role}: ${pick(PROMPTS)}`) });
  const steps = int(2, 7);
  let t = ts;
  let ctx = int(12_000, 30_000);
  for (let i = 0; i < steps; i++) {
    t += int(8, 60) * 1000;
    const nest = role === "coder" && depth === 1 && i === steps - 1 && rand() < 0.5;
    const tu = `toolu_${hex(20)}`;
    emit(path, { ...base(s, t, branch), ...sc, ...assistant(model, usage(ctx, i === 0), nest ? [{ type: "tool_use", id: tu, name: "Agent", input: { subagent_type: "reviewer" } }] : []) });
    if (nest) t += subagent(s, t + 1000, branch, "reviewer", tu, 2);
    ctx += int(2_000, 9_000);
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
      const spawnRole = s.manager && c === 0 && rand() < 0.6 ? pick(Object.keys(ROLE_MODEL)) : null;
      const tu = `toolu_${hex(20)}`;
      const content = spawnRole ? [{ type: "tool_use", id: tu, name: "Agent", input: { subagent_type: spawnRole } }] : [];
      emit(path, { ...base(s, t, branch), ...assistant(MODEL[s.model], usage(ctx, turn === 0 && c === 0), content) });
      if (spawnRole) t += subagent(s, t + 1000, branch, spawnRole, tu, 1);
      ctx += s.ctxGrowth;
    }
    t += int(1, 12) * MIN;
  }
  if (s.titled) emit(path, { type: "ai-title", sessionId: s.sid, aiTitle: pick(TITLES) });
  return t;
}

const weighted = PROJECTS.flatMap((p) => Array<typeof p>(p.weight).fill(p));
const now = Date.now();
function spec(start: number, over: Partial<Spec> = {}): Spec {
  const model: ModelKey = rand() < 0.45 ? "opus" : rand() < 0.75 ? "sonnet" : "haiku";
  return {
    sid: uuid(), project: pick(weighted), start, model, turns: int(2, 9), titled: rand() < 0.7, manager: rand() < 0.3,
    ctxStart: int(14_000, 28_000), ctxGrowth: int(1_500, 6_000), ...over,
  };
}

const specs: Spec[] = [];
for (let i = 0; i < SESSIONS; i++) specs.push(spec(now - DAYS * DAY + Math.floor(rand() * (DAYS - 1) * DAY)));
for (let i = 0; i < PREV_SESSIONS; i++) specs.push(spec(now - 2 * DAYS * DAY + Math.floor(rand() * (DAYS - 1) * DAY)));
for (const s of specs) {
  // Keep 200k-window models under their window so the context estimate stays at 200k (see context.window.ts).
  if (s.model !== "opus") s.ctxGrowth = Math.min(s.ctxGrowth, Math.floor((WINDOW_200K * 0.8 - s.ctxStart) / (s.turns * 4)));
  session(s);
}

// Two live sessions (last request minutes ago): one nearly out of context (~92% of 200k), one comfortable.
const LIVE_STEP_MIN = 10;
function live(over: Partial<Spec>, lastAgoMin: number, finalContext: number) {
  const s = spec(0, over);
  const path = fileFor(s.project.cwd, s.sid);
  const branch = s.project.branch[0]!;
  const fractions = [0.55, 0.7, 0.82, 1];
  fractions.forEach((f, i) => {
    const reply = now - (lastAgoMin + (fractions.length - 1 - i) * LIVE_STEP_MIN) * MIN; // last reply = lastAgoMin ago
    emit(path, { ...base(s, reply - 30_000, branch), ...prompt(pick(PROMPTS)) });
    emit(path, { ...base(s, reply, branch), ...assistant(MODEL[s.model], usage(Math.round(finalContext * f), i === 0)) });
  });
  emit(path, { type: "ai-title", sessionId: s.sid, aiTitle: pick(TITLES) });
}
live({ model: "sonnet", project: PROJECTS[0] }, 2, Math.round(WINDOW_200K * 0.92));
live({ model: "haiku", project: PROJECTS[7] }, 6, 64_000);

for (const [path, ls] of lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${ls.join("\n")}\n`);
}
for (const [path, meta] of metas) writeFileSync(path, JSON.stringify(meta));
const agents = metas.size;
console.log(`seed.demo: ${specs.length + 2} sessions, ${agents} subagents, ${PROJECTS.length} projects → ${projectsDir}`);
