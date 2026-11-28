import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_TIER_MODELS, type Config } from "../src/config/config.store.ts";
import { decide, nodePolicyFs } from "../src/policy/policy.eval.ts";
import { effectivePolicy, matrixOf } from "../src/policy/policy.effective.ts";
import { DEFAULT_TEST_COMMANDS, OWNER_ONLY_TOKENS } from "../src/policy/policy.presets.ts";
import type { HookInput, PolicyConfig, PolicySnapshot, PresetName } from "../src/policy/policy.types.ts";

// test-only: a config with no customisations, as withDefaults({}) would build it.
export const baseConfig = (extra: Partial<Config> = {}): Config => ({
  tiers: { ...DEFAULT_TIER_MODELS }, roleModels: {}, customRoles: {}, disabledRoles: [], storePromptText: true, ...extra,
});

export const policyConfig = (preset: PresetName, overrides: PolicyConfig["overrides"] = {}): PolicyConfig =>
  ({ enabled: true, preset, scope: "user", overrides });

export function snapshotFor(preset: PresetName, overrides: PolicyConfig["overrides"] = {}, extra: Partial<PolicySnapshot> = {}): PolicySnapshot {
  const matrix = matrixOf(effectivePolicy({ ...baseConfig(), policy: policyConfig(preset, overrides) }));
  return { version: 1, matrix, testCommands: [...DEFAULT_TEST_COMMANDS], ownerOnly: [...OWNER_ONLY_TOKENS], owned: {}, escalate: false, ...extra };
}

/** Temp project + HOME per test, realpath'd (macOS /var → /private/var). */
export function useProject() {
  const ctx = { root: "", project: "", home: "", outside: "" };
  beforeEach(() => {
    ctx.root = realpathSync(mkdtempSync(join(tmpdir(), "cm-policy-")));
    ctx.project = join(ctx.root, "project");
    ctx.home = join(ctx.root, "home");
    ctx.outside = join(ctx.root, "outside");
    for (const d of [ctx.project, ctx.home, ctx.outside]) mkdirSync(d, { recursive: true });
  });
  afterEach(() => rmSync(ctx.root, { recursive: true, force: true }));
  const write = (path: string, text = "x") => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  /** Worker call: agent_id set, cwd = project. */
  const call = (snap: PolicySnapshot, agent_type: unknown, tool_name: string, tool_input: unknown, more: HookInput = {}) =>
    decide({ agent_id: "a1", agent_type, tool_name, tool_input, cwd: ctx.project, ...more }, snap, nodePolicyFs, { HOME: ctx.home });
  const bash = (snap: PolicySnapshot, role: string, command: string) => call(snap, role, "Bash", { command });
  return { ctx, write, call, bash };
}
