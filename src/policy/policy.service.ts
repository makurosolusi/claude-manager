import { basename, isAbsolute, resolve } from "node:path";
import { CliError } from "../cli.error.ts";
import type { Config } from "../config/config.store.ts";
import type { Manifest } from "../install/install.manifest.ts";
import type { HookGroup, PolicyDesired } from "../install/settings.lists.ts";
import { effectivePolicy, matrixOf } from "./policy.effective.ts";
import {
  assertCells, assertOverrides, assertTestCommands, CAPABILITIES, DECISIONS, DEFAULT_TEST_COMMANDS, isCapability, isDecision,
  isPresetName, OWNER_ASK_RULES, OWNER_ONLY_TOKENS, PRESET_NAMES, SECRET_DENY_RULES,
} from "./policy.presets.ts";
import type { Capability, Decision, PolicyConfig, PolicySnapshot, PresetName } from "./policy.types.ts";

/** Tools the hook sees (§2.4); read-only tools are left out to save a process spawn per Read/Grep/Glob. */
export const HOOK_MATCHER = "Edit|Write|NotebookEdit|Bash|WebFetch|WebSearch|Agent|SendMessage|TaskStop|mcp__.*";
export const HOOK_ARGS: readonly string[] = ["hook", "pre-tool-use"];
export const HOOK_TIMEOUT_SECONDS = 5;
const DEFAULT_MODE_KEY = "permissions.defaultMode";
const POLICY_KEYS = new Set(["enabled", "preset", "scope", "projectDir", "overrides", "defaultMode", "testCommands"]);

const conflict = (msg: string): never => {
  throw new CliError(msg, 1, "conflict");
};

/** The stored policy; 409 when it was never set up. */
export function requirePolicy(config: Config): PolicyConfig {
  if (!config.policy) conflict('no permission policy yet. Run "claude-manager policy apply balanced" first');
  return config.policy!;
}

/** Throws a 400 CliError unless `policy` is a complete, valid PolicyConfig (used on every write, whoever built it). */
export function assertPolicy(policy: unknown): asserts policy is PolicyConfig {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new CliError("policy: expected an object");
  const p = policy as Record<string, unknown>;
  const unknown = Object.keys(p).filter((k) => !POLICY_KEYS.has(k));
  if (unknown.length) throw new CliError(`policy: unknown field "${unknown[0]}"`);
  if (typeof p.enabled !== "boolean") throw new CliError("policy.enabled: expected true or false");
  if (!isPresetName(p.preset)) throw new CliError(`unknown preset "${String(p.preset)}". Use ${PRESET_NAMES.join(", ")}`);
  if (p.scope !== "user" && p.scope !== "project") throw new CliError(`invalid scope "${String(p.scope)}": use "user" or "project"`);
  if (p.scope === "project" && (typeof p.projectDir !== "string" || !isAbsolute(p.projectDir))) {
    throw new CliError("project scope policy needs an absolute project directory (the git root)");
  }
  if (p.scope === "user" && p.projectDir !== undefined) throw new CliError("projectDir is only valid with project scope");
  assertOverrides(p.overrides);
  if (p.defaultMode !== undefined && p.defaultMode !== null && p.defaultMode !== "acceptEdits") {
    throw new CliError('defaultMode: only "acceptEdits" (or null) can be written');
  }
  if (p.testCommands !== undefined) assertTestCommands(p.testCommands);
}

const withPolicy = (config: Config, policy: PolicyConfig): Config => {
  assertPolicy(policy);
  return { ...structuredClone(config), policy };
};

/**
 * Sets the preset and scope and turns the policy on. Resets overrides (§7). `defaultMode`/`testCommands` left out keep
 * their stored value; `projectDir` is required for project scope.
 */
export function applyPreset(
  config: Config, preset: PresetName, scope: "user" | "project",
  extra: { projectDir?: string; defaultMode?: "acceptEdits" | null; testCommands?: string[] } = {},
): Config {
  const prev = config.policy;
  const policy: PolicyConfig = { enabled: true, preset, scope, overrides: {} };
  if (scope === "project") policy.projectDir = extra.projectDir;
  const defaultMode = extra.defaultMode !== undefined ? extra.defaultMode : prev?.defaultMode;
  if (defaultMode !== undefined) policy.defaultMode = defaultMode;
  const testCommands = extra.testCommands ?? prev?.testCommands;
  if (testCommands !== undefined) policy.testCommands = [...testCommands];
  return withPolicy(config, policy);
}

/** 404 unless `row` is main, an enabled role or unknown. */
function assertRow(config: Config, row: string): void {
  if (!effectivePolicy(config).some((r) => r.row === row)) throw new CliError(`unknown policy row "${row}". Rows: main, your enabled roles, unknown`, 1, "not_found");
}

/**
 * Sets one cell. A value equal to the preset drops the override, so the cell reads `source: "preset"` again;
 * `default` is a real value ("no hook decision"), not "back to preset".
 */
export function setCell(config: Config, row: string, cap: string, decision: string): Config {
  const policy = requirePolicy(config);
  assertRow(config, row);
  if (!isCapability(cap)) throw new CliError(`unknown capability "${cap}". Known: ${CAPABILITIES.join(", ")}`);
  if (!isDecision(decision)) throw new CliError(`bad decision "${decision}". Use ${DECISIONS.join(", ")}`);
  assertCells({ [cap]: decision }, row);
  const base = effectivePolicy({ ...config, policy: { ...policy, overrides: {} } }).find((r) => r.row === row)!.cells;
  const overrides = structuredClone(policy.overrides);
  const cells: Partial<Record<Capability, Decision>> = Object.hasOwn(overrides, row) ? overrides[row]! : {};
  if (base[cap].decision === decision) delete cells[cap];
  else cells[cap] = decision;
  if (Object.keys(cells).length) overrides[row] = cells;
  else delete overrides[row];
  return withPolicy(config, { ...policy, overrides });
}

/** Replaces all overrides; every row must exist. */
export function setOverrides(config: Config, overrides: unknown): Config {
  const policy = requirePolicy(config);
  assertOverrides(overrides);
  for (const row of Object.keys(overrides)) assertRow(config, row);
  return withPolicy(config, { ...policy, overrides: structuredClone(overrides) });
}

/** Replaces the test command list (null = back to the defaults). */
export function setTestCommands(config: Config, testCommands: unknown): Config {
  const { testCommands: _old, ...policy } = requirePolicy(config);
  if (testCommands === null) return withPolicy(config, policy);
  assertTestCommands(testCommands);
  return withPolicy(config, { ...policy, testCommands: [...testCommands] });
}

/** Turns the stored policy back on (writes settings + snapshot again on apply). */
export const enablePolicy = (config: Config): Config => withPolicy(config, { ...requirePolicy(config), enabled: true });

/** Turns the policy off; the matrix stays in config.json so enable restores it (§5 DELETE). */
export const disablePolicy = (config: Config): Config => withPolicy(config, { ...requirePolicy(config), enabled: false });

/**
 * Hook command for the running process (§2.4), always absolute and exec form (no shell, no PATH lookup).
 * Compiled binary: `<binary> hook pre-tool-use`. From source (`bun src/cli.ts`): `<bun> <abs src/cli.ts> hook pre-tool-use`;
 * a dev hook stops working when the checkout moves, which doctor reports.
 */
export function hookCommand(execPath = process.execPath): { command: string; args: string[] } {
  const fromSource = /^bun(?:\.exe)?$/i.test(basename(execPath));
  return { command: execPath, args: fromSource ? [resolve(import.meta.dir, "..", "cli.ts"), ...HOOK_ARGS] : [...HOOK_ARGS] };
}

export function hookGroup(execPath?: string): HookGroup {
  const { command, args } = hookCommand(execPath);
  return { matcher: HOOK_MATCHER, hooks: [{ type: "command", command, args, timeout: HOOK_TIMEOUT_SECONDS }] };
}

/** What an enabled policy wants in its settings file: the owner mandate (§2.4), the hook, and opt-in defaultMode (§2.5). */
export function desiredSettings(policy: PolicyConfig, execPath?: string): PolicyDesired {
  const entries = [
    ...OWNER_ASK_RULES.map((value) => ({ list: "permissions.ask" as const, value })),
    ...SECRET_DENY_RULES.map((value) => ({ list: "permissions.deny" as const, value })),
  ];
  const keys = policy.defaultMode === "acceptEdits" ? { [DEFAULT_MODE_KEY]: "acceptEdits" } : {};
  return { entries, hook: hookGroup(execPath), keys };
}

/** The compiled snapshot (§2.6). `owned` = every managed agent file → the sha256 the installer recorded for it. */
export function compileSnapshot(config: Config, manifest: Manifest): PolicySnapshot {
  const policy = requirePolicy(config);
  const owned: Record<string, string> = {};
  for (const rec of Object.values(manifest.installs)) for (const [path, file] of Object.entries(rec.files)) owned[path] = file.sha256;
  const snapshot: PolicySnapshot = {
    version: 1,
    matrix: matrixOf(effectivePolicy(config)),
    testCommands: [...(policy.testCommands ?? DEFAULT_TEST_COMMANDS)],
    ownerOnly: [...OWNER_ONLY_TOKENS],
    owned,
  };
  if (policy.scope === "project" && policy.projectDir) snapshot.projectDir = policy.projectDir;
  return snapshot;
}
