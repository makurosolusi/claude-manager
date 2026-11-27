// Appends synthetic transcript lines to the newest sessions made by seed.demo.ts, like Claude Code does mid-session.
// Usage: bun scripts/seed.live.ts <claude-config-dir> [--interval-ms 2000]   (stop with Ctrl-C)
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_MODELS, TOOLS } from "./seed.demo.data.ts";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--interval-ms");
const i = args.indexOf("--interval-ms");
const intervalMs = i >= 0 ? Number(args[i + 1]) : 2000;
if (!root || !(intervalMs > 0)) {
  console.error("usage: bun scripts/seed.live.ts <claude-config-dir> [--interval-ms 2000]");
  process.exit(1);
}
const LIVE_SESSIONS = 2;
const SUBAGENT_CHANCE = 0.25;
const projectsDir = join(root, "projects");

interface Live { path: string; dir: string; sid: string; cwd: string; branch: string; model: string; ctx: number }

/** The sessions whose last request is newest: the seed's "live" ones (all others end days earlier). */
function findLive(): Live[] {
  const found: (Live & { last: number })[] = [];
  for (const proj of readdirSync(projectsDir)) {
    for (const f of readdirSync(join(projectsDir, proj)).filter((n) => n.endsWith(".jsonl"))) {
      const path = join(projectsDir, proj, f);
      const entries = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const a = entries.filter((e) => e.type === "assistant");
      const u = a.at(-1)?.message?.usage;
      if (!u || !entries[0]?.cwd) continue;
      found.push({
        path, dir: join(projectsDir, proj), sid: f.replace(/\.jsonl$/, ""), cwd: entries[0].cwd, branch: entries[0].gitBranch ?? "main",
        model: a.at(-1).message.model, ctx: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        last: Date.parse(a.at(-1).timestamp),
      });
    }
  }
  return found.sort((x, y) => y.last - x.last).slice(0, LIVE_SESSIONS);
}

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const rint = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const write = (path: string, e: Record<string, unknown>) => appendFileSync(path, `${JSON.stringify(e)}\n`);
const base = (l: Live, sc: object = {}) => ({
  sessionId: l.sid, timestamp: new Date().toISOString(), uuid: `u-live-${hex(10)}`, cwd: l.cwd, gitBranch: l.branch, version: "2.5.4", ...sc,
});
const reply = (model: string, ctx: number, content: unknown[]) => ({
  type: "assistant", requestId: `req_${hex(16)}`,
  message: {
    id: `msg_${hex(20)}`, model, content, stop_reason: content.length ? "tool_use" : "end_turn",
    usage: { input_tokens: rint(3, 40), cache_read_input_tokens: ctx, cache_creation_input_tokens: rint(800, 4000), output_tokens: rint(150, 2000) },
  },
});
const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: `toolu_${hex(20)}`, name, input });

function spawnSubagent(l: Live) {
  const role = pick(Object.keys(ROLE_MODELS));
  const agentId = hex(17);
  const dir = join(l.dir, l.sid, "subagents");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `agent-${agentId}.jsonl`);
  const sc = { isSidechain: true, agentId };
  const tool = toolUse("Agent", { subagent_type: role });
  write(l.path, { ...base(l), ...reply(l.model, l.ctx, [tool]) });
  write(path, { ...base(l, sc), type: "user", promptSource: "typed", message: { role: "user", content: `${role}: check the latest change` } });
  const t = pick(TOOLS);
  write(path, { ...base(l, sc), ...reply(pick(ROLE_MODELS[role]!), rint(15_000, 40_000), [toolUse(t.name, t.input)]) });
  writeFileSync(path.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: role, description: `${role} live task`, toolUseId: tool.id, spawnDepth: 1 }));
}

const lives = findLive();
if (!lives.length) {
  console.error(`seed.live: no seeded sessions under ${projectsDir}; run seed.demo.ts first`);
  process.exit(1);
}
console.log(`seed.live: appending to ${lives.length} sessions every ${intervalMs}ms (Ctrl-C to stop)`);

let ticks = 0;
const timer = setInterval(() => {
  const n = rint(1, 2);
  for (let k = 0; k < n; k++) {
    const l = pick(lives);
    write(l.path, { ...base(l), type: "user", promptSource: "typed", message: { role: "user", content: "Keep going with the next step." } });
    if (Math.random() < SUBAGENT_CHANCE) spawnSubagent(l);
    const t = pick(TOOLS);
    write(l.path, { ...base(l), ...reply(l.model, l.ctx, [toolUse(t.name, t.input)]) });
    l.ctx += rint(1_000, 4_000);
  }
  ticks++;
}, intervalMs);
process.on("SIGINT", () => {
  clearInterval(timer);
  console.log(`seed.live: stopped after ${ticks} ticks`);
  process.exit(0);
});
