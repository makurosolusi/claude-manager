/** Permission policy data model (spec PLAN/08 §2). Pure types; no runtime code. */

/** What a tool call does, as the policy sees it (§2.1). */
export type Capability = "read" | "edit" | "test" | "shell" | "web" | "agents" | "git" | "push" | "mcp";
/** Cell value; `default` = no hook decision, Claude Code's own mode and rules decide. */
export type Decision = "allow" | "ask" | "deny" | "default";
export type PresetName = "strict" | "balanced" | "autonomous";

/** `config.json` `policy` key (§2.2); absent = never set up. */
export interface PolicyConfig {
  enabled: boolean;
  preset: PresetName;
  scope: "user" | "project";
  /** scope=project only; absolute git root. */
  projectDir?: string;
  /** Row name (role | "main" | "unknown") → capability overrides. */
  overrides: Record<string, Partial<Record<Capability, Decision>>>;
  defaultMode?: "acceptEdits" | null;
  testCommands?: string[];
}

export type PolicyMatrix = Record<string, Record<Capability, Decision>>;

/** One row of the effective matrix, with where each cell came from (§5 `PolicyRow`). */
export interface PolicyRow {
  row: string;
  kind: "main" | "preset" | "custom" | "unknown";
  cells: Record<Capability, { decision: Decision; source: "preset" | "override" }>;
}

/** `~/.claude-manager/policy.compiled.json`, the only file the hook reads (§2.6). */
export interface PolicySnapshot {
  version: 1;
  matrix: PolicyMatrix;
  testCommands: string[];
  /** Hook-side owner-only tokens; unioned with OWNER_ONLY_TOKENS so a bad snapshot can't drop the floor. */
  ownerOnly: string[];
  /** Managed agent file path (absolute) → sha256 hex of its content. */
  owned: Record<string, string>;
  projectDir?: string;
}

/** PreToolUse stdin fields the policy reads (§3); everything else is ignored. All untrusted. */
export interface HookInput {
  tool_name?: unknown;
  tool_input?: unknown;
  agent_id?: unknown;
  agent_type?: unknown;
  cwd?: unknown;
  permission_mode?: unknown;
  session_id?: unknown;
}

/** The only I/O `decide` may do. Each returns null for a missing path and throws on any other error. */
export interface PolicyFs {
  /** Canonical path with symlinks resolved; null when the path (or a link target) doesn't exist. */
  realpath(path: string): string | null;
  /** True when something (including a dangling symlink) exists at the path itself. */
  lexists(path: string): boolean;
  /** UTF-8 file content; null when missing. */
  readText(path: string): string | null;
  /** Entry names in a directory; null when it doesn't exist. */
  listDir(path: string): string[] | null;
}

/** Process env values `decide` may consult; passed in so `decide` stays pure. */
export interface PolicyEnv {
  CLAUDE_PROJECT_DIR?: string;
  HOME?: string;
}

/** Outcome of `decide`; `rule` is a fixed audit id (§2.7), `reason` never echoes the input. */
export interface PolicyResult {
  decision: Decision;
  row: string;
  cap: Capability | null;
  rule: string;
  reason: string;
}
