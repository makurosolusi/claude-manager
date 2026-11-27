// Static tables for scripts/seed.demo.ts. All fake: /work/... paths, invented titles, no real data.

export const MODEL = { opus: "claude-opus-4-7", sonnet: "claude-sonnet-4-5", haiku: "claude-haiku-4-5" } as const;
export type ModelKey = keyof typeof MODEL;

/** Role → tier model, as in src/roles/roles.presets.ts (think=opus, work=sonnet, basic=haiku); ui-ux is custom, general-purpose is a Claude built-in. */
export const ROLE_MODEL: Record<string, ModelKey> = {
  manager: "opus", architect: "opus", researcher: "haiku", coder: "sonnet", reviewer: "sonnet", writer: "haiku",
  "ui-ux": "sonnet", "general-purpose": "sonnet",
};

// Two projects share the basename "web" on purpose: the UI must not rely on basename alone.
export const PROJECTS = [
  { cwd: "/work/acme/api", branch: ["main", "feat/billing-v2", "fix/rate-limit"], weight: 5 },
  { cwd: "/work/acme/web", branch: ["main", "feat/onboarding"], weight: 4 },
  { cwd: "/work/side/web", branch: ["main"], weight: 2 },
  { cwd: "/work/acme/infra-terraform", branch: ["main", "chore/upgrade-provider"], weight: 2 },
  { cwd: "/work/oss/bun-sqlite-kit", branch: ["main"], weight: 2 },
  { cwd: "/work/notes/research-llm-evals", branch: ["main"], weight: 1 },
  { cwd: "/work/acme/mobile-app", branch: ["develop", "feat/push"], weight: 2 },
  { cwd: "/work/claude-manager", branch: ["main", "feature/m5-ui-polish"], weight: 3 },
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
