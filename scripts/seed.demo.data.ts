// Static tables for scripts/seed.demo.ts. All fake: ~/work/... paths, invented titles, no real data.

/** Main-session model pool per tier (200k-window tiers stay on 4.x ids so the live context-level cases hold). */
export const MODEL = {
  opus: ["claude-opus-4-7", "claude-opus-5", "claude-fable-5-2"],
  sonnet: ["claude-sonnet-4-5"],
  haiku: ["claude-haiku-4-5"],
} as const;
export type ModelKey = keyof typeof MODEL;

const OPUS = ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-fable-5-2"];
const SONNET = ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5"];
const HAIKU = ["claude-haiku-5-5", "claude-haiku-4-5"];
/** Subagent role -> models that serve it (4-8 each for the big roles). Presets, custom ui-ux, then Claude Code built-ins. */
export const ROLE_MODELS: Record<string, readonly string[]> = {
  manager: OPUS, architect: [...OPUS.slice(0, 4), "claude-sonnet-5-5"], researcher: [...HAIKU, "claude-sonnet-5", "claude-haiku-5-5"],
  coder: [...SONNET, "claude-opus-5-5", "claude-opus-4-8"], reviewer: [...SONNET.slice(0, 3), "claude-opus-5"], writer: [...HAIKU, "claude-sonnet-5-5"],
  "ui-ux": [...SONNET.slice(0, 3), "claude-fable-5-2"],
  "general-purpose": [...SONNET, "claude-opus-5", "claude-haiku-5-5"], Explore: [...HAIKU, "claude-haiku-4-5", "claude-sonnet-5"],
  Plan: [...OPUS.slice(0, 3), "claude-sonnet-5-5"], fork: [...OPUS.slice(0, 2), ...SONNET.slice(0, 2), "claude-fable-5-2"],
  "web-fetch": HAIKU, claude: [...SONNET.slice(0, 2), "claude-opus-5"], "statusline-setup": ["claude-haiku-5-5", "claude-haiku-4-5"],
};
/** Roles whose subagents sometimes run long on a ~1M context, so totals reach billions of tokens. */
export const HEAVY_ROLES = ["coder", "architect", "manager", "general-purpose", "fork"];

// Two projects share the basename "web" on purpose: the UI must not rely on basename alone.
// `~` expands to the temp HOME and `$TMP` to the OS temp dir, so every project kind shows on the Projects page:
// real projects under three parent folders, an agent worktree of ~/work/acme/web, a temp-dir run and a run from home itself.
// Keep the first 8 entries first: the live/idle demo sessions index into them.
export const PROJECTS = [
  { cwd: "~/work/acme/api", branch: ["main", "feat/billing-v2", "fix/rate-limit"], weight: 5 },
  { cwd: "~/work/acme/web", branch: ["main", "feat/onboarding"], weight: 4 },
  { cwd: "~/side/web", branch: ["main"], weight: 2 },
  { cwd: "~/work/acme/infra-terraform", branch: ["main", "chore/upgrade-provider"], weight: 2 },
  { cwd: "~/oss/bun-sqlite-kit", branch: ["main"], weight: 2 },
  { cwd: "~/side/research-llm-evals", branch: ["main"], weight: 1 },
  { cwd: "~/work/acme/mobile-app", branch: ["develop", "feat/push"], weight: 2 },
  { cwd: "~/oss/claude-manager", branch: ["main", "feature/m5-ui-polish"], weight: 3 },
  { cwd: "~/work/acme/web/.claude/worktrees/task-ag-a6ef89935c86980d7c79", branch: ["worktree-task-ag-a6ef89935c86980d7c79"], weight: 1 },
  { cwd: "$TMP/cm-demo-scratch", branch: ["main"], weight: 1 },
  { cwd: "~", branch: ["main"], weight: 1 },
];

export const TITLES = [
  "Add Stripe webhook retry with idempotency keys", "Fix flaky login e2e test", "Refactor session store to Redis",
  "Migrate Terraform AWS provider to v6", "Investigate p95 latency spike on /search", "Write onboarding checklist component",
  "Add SQLite WAL checkpoint tuning", "Review PR #482 rate limiter", "Draft CHANGELOG for 2.3.0", "Implement push notification opt-in",
  "Explain eval harness scoring drift", "Split dashboard repository into modules", "Add pagination to /api/projects",
  "Debug CORS preflight on staging", "Port settings page to React 19", "Tighten CSP headers",
];
/** One title of 80+ characters to exercise truncation. */
export const LONG_TITLE =
  "Investigate intermittent timeout in the nightly billing reconciliation job after the provider upgrade and document the findings";

export const PROMPTS = [
  "Look at the failing test and find the root cause before changing anything.", "Implement this and add a test.",
  "Can you review the diff for correctness bugs?", "Summarize what changed since yesterday.",
  "Plan the migration: files to touch, risks, order of work.", "Make the error message include the session id.",
  "Run the test suite and fix what breaks.", "Rename the module and update every import.",
];

/** Non-Agent tool_use blocks (name + minimal input), picked at random for variety. */
export const TOOLS: { name: string; input: Record<string, unknown> }[] = [
  { name: "Read", input: { file_path: "/work/src/index.ts" } },
  { name: "Edit", input: { file_path: "/work/src/index.ts", old_string: "a", new_string: "b" } },
  { name: "Write", input: { file_path: "/work/src/new.ts", content: "export {}" } },
  { name: "Bash", input: { command: "bun test" } },
  { name: "Grep", input: { pattern: "TODO" } },
  { name: "Glob", input: { pattern: "**/*.ts" } },
  { name: "WebSearch", input: { query: "sqlite wal checkpoint" } },
  { name: "WebFetch", input: { url: "https://example.com/docs" } },
  { name: "TodoWrite", input: { todos: [] } },
  { name: "mcp__docs__search", input: { query: "rate limiting" } },
];

/** `claude-manager` CLI steps the demo runs against the temp config (real code path: config.json, then install writes files + manifest). */
export const MANAGER_STEPS: string[][] = [
  ["roles", "add", "ui-ux", "--tier", "work", "--tools", "Read,Grep,Glob,Edit,Write", "--description", "Designs UI layouts, accessibility and visual polish"],
  ["roles", "rm", "writer"], // disables a preset
  ["install", "--scope", "user"],
];

/** Hand-written agent files (external: not managed by claude-manager), written to `<config>/agents/<name>.md`. */
export const EXTERNAL_AGENTS: Record<string, string> = {
  "code-simplifier": `---
name: code-simplifier
description: Simplifies recently changed code without altering behaviour. Use after a feature lands.
tools: Read, Edit, Grep, Glob
model: sonnet
color: cyan
---
You simplify recently modified code: remove dead branches, flatten nesting, keep behaviour identical.
Never touch tests unless they fail to compile.
`,
};
