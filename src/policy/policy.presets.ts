import { CliError } from "../cli.error.ts";
import type { Tier } from "../config/config.store.ts";
import type { Capability, Decision, PolicyConfig, PresetName } from "./policy.types.ts";

export const CAPABILITIES: readonly Capability[] = ["read", "edit", "test", "shell", "web", "agents", "git", "push", "mcp"];
export const DECISIONS: readonly Decision[] = ["allow", "ask", "deny", "default"];
export const PRESET_NAMES: readonly PresetName[] = ["strict", "balanced", "autonomous"];
export const RECOMMENDED_PRESET: PresetName = "balanced";
export const PRESET_LABEL: Record<PresetName, string> = { strict: "Strict", balanced: "Balanced", autonomous: "Autonomous" };

/** The owner's own session (no `agent_id`). */
export const MAIN_ROW = "main";
/** Built-ins, plugin, external, disabled and shadowed agents. */
export const UNKNOWN_ROW = "unknown";
export const RESERVED_ROWS: readonly string[] = [MAIN_ROW, UNKNOWN_ROW];

/** Capabilities that can never be `allow` (§4.4). */
export const OWNER_ONLY_CAPS: readonly Capability[] = ["push"];
export const PUSH_ALLOW_ERROR = "push is owner-only; use ask or deny";

/** Bash words that make a command owner-only (§3 step 2). `vercel` deploys with no subcommand. */
export const OWNER_ONLY_TOKENS: readonly string[] = ["push", "publish", "deploy", "release", "vercel"];

export const DEFAULT_TEST_COMMANDS: readonly string[] = [
  "bun test", "bun run test", "bun run build", "bunx tsc", "npm test", "npm run test", "npm run build",
  "pnpm test", "yarn test", "cargo test", "go test", "pytest",
];
export const TEST_COMMANDS_MAX = 32;
export const TEST_COMMAND_MAX_CHARS = 80;
/** Characters that make a Bash command compound (§3 step 4); also refused in `testCommands`. */
export const SHELL_META_RE = /[;&|<>$`()\n\r]/;

/** Owner mandate written to settings (§2.4); constants, not config, in v0.4.0. */
export const OWNER_ASK_RULES: readonly string[] = [
  "Bash(git push *)", "Bash(git push)", "Bash(npm publish *)", "Bash(bun publish *)", "Bash(gh release *)",
  "Bash(rm -rf *)", "Bash(rm -r *)", "Bash(vercel *)", "Bash(fly deploy *)", "Bash(docker push *)",
];
export const SECRET_DENY_RULES: readonly string[] = [
  "Read(**/.env)", "Read(**/.env.*)", "Edit(**/.env)", "Edit(**/.env.*)", "Read(**/*.pem)", "Read(**/*.key)",
  "Read(**/*.p12)", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(**/credentials.json)", "Read(**/service-account.json)",
];

type Cells = Partial<Record<Capability, Decision>>;
/** Preset templates; a role row is picked by preset role name, a custom role by its tier (§2.2 table). */
type Template = "manager" | "analyst" | "coder" | "reviewer" | "writer";

const MANAGER: Cells = { read: "allow", agents: "allow" };
const PRESETS: Record<PresetName, Record<Template, Cells>> = {
  strict: {
    manager: MANAGER,
    analyst: { read: "allow", web: "ask", edit: "deny", shell: "deny" },
    coder: { read: "allow", edit: "ask", test: "ask", shell: "ask", web: "ask", agents: "ask", git: "ask", mcp: "ask" },
    reviewer: { read: "allow", test: "ask", edit: "deny" },
    writer: { read: "allow", edit: "ask" },
  },
  balanced: {
    manager: MANAGER,
    analyst: { read: "allow", web: "allow", edit: "deny", shell: "deny" },
    coder: { read: "allow", edit: "allow", test: "allow", git: "ask", shell: "ask", web: "ask" },
    reviewer: { read: "allow", test: "allow", edit: "deny", shell: "ask" },
    writer: { read: "allow", edit: "allow", shell: "deny" },
  },
  autonomous: {
    manager: MANAGER,
    analyst: { read: "allow", web: "allow" },
    coder: { read: "allow", edit: "allow", test: "allow", git: "allow", shell: "allow", web: "allow" },
    reviewer: { read: "allow", test: "allow", shell: "allow", edit: "deny" },
    writer: { read: "allow", edit: "allow", web: "allow" },
  },
};
const ROLE_TEMPLATE: Record<string, Template> = {
  manager: "manager", architect: "analyst", researcher: "analyst", coder: "coder", reviewer: "reviewer", writer: "writer",
};
const TIER_TEMPLATE: Record<Tier, Template> = { think: "analyst", work: "coder", basic: "writer" };

/** Full row with every capability filled: unlisted cells `default`, `push` always `ask`. */
const fill = (cells: Cells): Record<Capability, Decision> =>
  Object.fromEntries(CAPABILITIES.map((c) => [c, c === "push" ? "ask" : (cells[c] ?? "default")])) as Record<Capability, Decision>;

/** Preset row for main/unknown, a preset role (by name) or a custom role (by tier). */
export function presetRow(preset: PresetName, row: string, kind: "main" | "preset" | "custom" | "unknown", tier?: Tier): Record<Capability, Decision> {
  if (kind === "main" || kind === "unknown") return fill({});
  const template = kind === "preset" && Object.hasOwn(ROLE_TEMPLATE, row) ? ROLE_TEMPLATE[row] : tier ? TIER_TEMPLATE[tier] : undefined;
  return fill(template ? PRESETS[preset][template] : {});
}

export const isCapability = (v: unknown): v is Capability => typeof v === "string" && (CAPABILITIES as string[]).includes(v);
export const isDecision = (v: unknown): v is Decision => typeof v === "string" && (DECISIONS as string[]).includes(v);
export const isPresetName = (v: unknown): v is PresetName => typeof v === "string" && (PRESET_NAMES as string[]).includes(v);
/** False for `allow` on an owner-only capability; every caller that stores or serves a cell checks this. */
export const isCellAllowed = (cap: Capability, d: Decision) => !(d === "allow" && OWNER_ONLY_CAPS.includes(cap));

/** Throws a 400 CliError unless `cells` is a valid row patch (known capabilities and decisions, no push allow). */
export function assertCells(cells: unknown, row = "row"): asserts cells is Cells {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) throw new CliError(`${row}: expected an object of capability → decision`);
  for (const [cap, decision] of Object.entries(cells)) {
    if (!isCapability(cap)) throw new CliError(`${row}: unknown capability "${cap}". Known: ${CAPABILITIES.join(", ")}`);
    if (!isDecision(decision)) throw new CliError(`${row}.${cap}: bad decision "${String(decision)}". Use ${DECISIONS.join(", ")}`);
    if (!isCellAllowed(cap, decision)) throw new CliError(PUSH_ALLOW_ERROR);
  }
}

/** Throws a 400 CliError unless every override row passes `assertCells`. */
export function assertOverrides(overrides: unknown): asserts overrides is PolicyConfig["overrides"] {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new CliError("overrides: expected an object");
  for (const [row, cells] of Object.entries(overrides)) assertCells(cells, row);
}

/** Throws a 400 CliError unless `list` is a valid `testCommands` value (§2.2: ≤ 32 entries, ≤ 80 chars, no shell metacharacters). */
export function assertTestCommands(list: unknown): asserts list is string[] {
  if (!Array.isArray(list) || list.length > TEST_COMMANDS_MAX) throw new CliError(`testCommands: expected at most ${TEST_COMMANDS_MAX} strings`);
  for (const cmd of list) {
    if (typeof cmd !== "string" || !cmd.trim() || cmd.length > TEST_COMMAND_MAX_CHARS) {
      throw new CliError(`testCommands: each entry must be a non-empty string of at most ${TEST_COMMAND_MAX_CHARS} characters`);
    }
    if (SHELL_META_RE.test(cmd) || cmd.includes("'")) throw new CliError(`testCommands: "${cmd}" contains shell metacharacters`);
  }
}
