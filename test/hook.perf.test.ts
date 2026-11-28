import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBinary } from "../scripts/build.ts";
import { hookEnv, runHookProc } from "./hook.fixture.ts";

const RUNS = 30;
/** Spec §3 performance budget for one hook call on the compiled binary; asserted only with CM_PERF_STRICT=1. */
const P95_BUDGET_MS = 50;
/** Default bound: catches a real regression (e.g. sqlite or config loaded on the hot path) without failing on a loaded machine. */
const HOOK_P95_SANITY_MS = 150;
const STRICT = process.env.CM_PERF_STRICT === "1";
const P95_LIMIT_MS = STRICT ? P95_BUDGET_MS : HOOK_P95_SANITY_MS;

let dir: string;
let bin: string;
let e: ReturnType<typeof hookEnv>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cm-hookperf-"));
  bin = join(dir, "claude-manager");
  await buildBinary(bin);
  e = hookEnv();
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  e?.cleanup();
});

test(`hook pre-tool-use p95 <= ${P95_LIMIT_MS} ms on the compiled binary`, async () => {
  const stdin = JSON.stringify({ session_id: "s", agent_id: "a", agent_type: "coder", tool_name: "Edit", tool_input: { file_path: join(e.project, "a.ts") }, cwd: e.project });
  await runHookProc([bin], e.env, stdin); // warm the file cache
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const r = await runHookProc([bin], e.env, stdin);
    times.push(performance.now() - t0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("allow");
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(RUNS * 0.5)]!;
  const p95 = times[Math.ceil(RUNS * 0.95) - 1]!;
  console.log(`hook perf: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms over ${RUNS} runs (budget ${P95_BUDGET_MS}ms, asserting ${P95_LIMIT_MS}ms${STRICT ? ", strict" : ""})`);
  expect(p95).toBeLessThanOrEqual(P95_LIMIT_MS);
}, 60_000);
