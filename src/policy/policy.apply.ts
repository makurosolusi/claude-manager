import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../cli.error.ts";
import { type ConfigBuild, StaleConfigError, withConfigLock } from "../config/config.apply.ts";
import { type Config, configPath, loadConfig } from "../config/config.store.ts";
import { backupPath, loadManifest, type Manifest, type PolicyRecord, saveManifest } from "../install/install.manifest.ts";
import { parseSettings, readText, resolveTarget } from "../install/install.target.ts";
import { getKey, type Settings } from "../install/settings.merge.ts";
import {
  applyPolicySettings, type HookGroup, type ListChange, planPolicy, type PolicyDesired, policySettingsPath, type PolicySettingsRecord,
  revertPolicySettings,
} from "../install/settings.lists.ts";
import { sha256, writeJson } from "../storage/json.file.ts";
import { effectivePolicy } from "./policy.effective.ts";
import { policySnapshotPath } from "./policy.paths.ts";
import { assertPolicy, compileSnapshot, desiredSettings } from "./policy.service.ts";
import type { PolicyRow, PolicySnapshot } from "./policy.types.ts";

/** One planned settings change in one file (§5 `SettingsChange`). */
export type SettingsChange = { path: string } & ListChange;

/** Everything an apply would write; preview returns it, apply writes exactly it. */
export interface PolicyPlan {
  /** The file the policy lives in after apply; null = no policy settings anywhere (disabled, never applied). */
  settingsPath: string | null;
  changes: SettingsChange[];
  hook: HookGroup | null;
  /** Written to `compiledPath`; null = removed (disabled). */
  snapshot: PolicySnapshot | null;
  compiledPath: string;
  rows: PolicyRow[];
  /** If-Match value for the apply: sha256(config.json text + "\0" + target settings text). */
  etag: string;
}

export interface PolicyApplyResult { config: Config; plan: PolicyPlan; etag: string }

const NOTHING: PolicyDesired = { entries: [], hook: null, keys: {} };

/** §5 etag: config.json and the target settings file; a hand edit to either between preview and apply → 412. */
export const policyEtag = (configText: string | undefined, settingsText: string | undefined): string =>
  sha256(`${configText ?? "none"}\0${settingsText ?? "none"}`);

/**
 * The settings file a state's etag covers: the stored policy's target (enabled or disabled, so an enable after a
 * disable still sees edits to it), else the file the policy was last written to, else none.
 */
const etagSettingsPath = (config: Config, manifest: Manifest): string | undefined =>
  config.policy ? policySettingsPath(config.policy.scope, config.policy.projectDir) : manifest.policy?.settingsPath;

/** Etag of the current state; GET returns it, and every write accepts it (§5). */
export async function currentEtag(config: Config, manifest: Manifest, configText?: string): Promise<string> {
  const path = etagSettingsPath(config, manifest);
  return policyEtag(configText ?? (await readText(configPath())), path ? await readText(path) : undefined);
}

/** Settings text + parsed object; an unparsable file is 409 (`fix <path> first`), not a bad request. */
async function readSettings(path: string): Promise<{ raw: string | undefined; settings: Settings }> {
  const raw = await readText(path);
  try {
    return { raw, settings: parseSettings(raw, path) };
  } catch (err) {
    throw new CliError(`${(err as Error).message}. Fix ${path} first`, 1, "conflict");
  }
}

/** Settings file for an enabled policy; 400 unless projectDir is a git root, 409 without an install in that scope. */
function targetPath(next: Config, manifest: Manifest): string {
  const { scope, projectDir } = next.policy!;
  if (scope === "project" && !existsSync(join(projectDir!, ".git"))) {
    throw new CliError(`${projectDir} is not a git root: project scope policy must live at the repository root`);
  }
  const installPath = scope === "user" ? resolveTarget("user").settingsPath : join(projectDir!, ".claude", "settings.json");
  if (!manifest.installs[installPath]) {
    throw new CliError(`claude-manager is not installed in ${scope} scope. Run "claude-manager install --scope ${scope}" first`, 1, "conflict");
  }
  return policySettingsPath(scope, projectDir);
}

/**
 * Our hook group as the file holds it: when the recorded group is gone but one with the same command + args is there
 * (hand-edited), that one is treated as ours, so the re-apply replaces it instead of appending a duplicate.
 */
function adoptEditedHook(settings: Settings, prior: PolicySettingsRecord | undefined): PolicySettingsRecord | undefined {
  const group = prior?.hook?.group as HookGroup | undefined;
  const groups = getKey(settings, "hooks.PreToolUse");
  if (!prior || !group || !Array.isArray(groups) || groups.some((g) => Bun.deepEquals(g, group))) return prior;
  const ours = group.hooks?.[0];
  const edited = groups.find((g) =>
    (g as HookGroup)?.hooks?.some?.((h) => h?.command === ours?.command && Bun.deepEquals(h?.args, ours?.args)),
  );
  return edited ? { ...prior, hook: { group: edited } } : prior;
}

/** What reverting `prior` changes (pure plan on a copy; the write itself is `revertPolicySettings`). */
function revertChanges(prior: PolicySettingsRecord, settings: Settings): SettingsChange[] {
  const { changes } = planPolicy(structuredClone(settings), NOTHING, prior);
  const keys = Object.entries(prior.keys).map(([list, rec]) => ({ op: "set" as const, list, value: rec.prev }));
  return [...changes, ...keys].map((c) => ({ path: prior.settingsPath, ...c }));
}

interface Planned {
  plan: PolicyPlan;
  /** Enable: settings to write, and the (possibly adopted) prior record. */
  write?: { path: string; desired: PolicyDesired; prior?: PolicySettingsRecord };
  /** Policy settings to revert first: the whole policy (disable) or its old file (scope moved). */
  revert?: PolicyRecord;
}

async function planChange(next: Config, manifest: Manifest, configText: string | undefined): Promise<Planned> {
  if (next.policy !== undefined) assertPolicy(next.policy);
  const prior = manifest.policy;
  const base = { compiledPath: policySnapshotPath(), rows: effectivePolicy(next), hook: null, snapshot: null };
  if (!next.policy?.enabled) {
    if (!prior) return { plan: { ...base, settingsPath: null, changes: [], etag: policyEtag(configText, undefined) } };
    const { raw, settings } = await readSettings(prior.settingsPath);
    const plan = { ...base, settingsPath: prior.settingsPath, changes: revertChanges(prior, settings), etag: policyEtag(configText, raw) };
    return { plan, revert: prior };
  }
  const path = targetPath(next, manifest);
  const moved = prior && prior.settingsPath !== path ? prior : undefined;
  const changes = moved ? revertChanges(moved, (await readSettings(moved.settingsPath)).settings) : [];
  const { raw, settings } = await readSettings(path);
  const write = { path, desired: desiredSettings(next.policy), prior: moved ? undefined : adoptEditedHook(settings, prior) };
  const dry = await applyPolicySettings(path, write.desired, write.prior, { dryRun: true });
  changes.push(...dry.changes.map((c) => ({ path, ...c })));
  const plan = {
    ...base, settingsPath: path, changes, hook: write.desired.hook, snapshot: compileSnapshot(next, manifest), etag: policyEtag(configText, raw),
  };
  return { plan, write, revert: moved };
}

/** What `applyPolicy` would write for `next`; writes nothing. */
export async function previewPolicy(next: Config): Promise<PolicyPlan> {
  return (await planChange(next, await loadManifest(), await readText(configPath()))).plan;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Puts `text` back at `path` atomically (undefined = no file); skips a file that already holds it (e.g. a read-only dir). */
async function restoreText(path: string, text: string | undefined): Promise<void> {
  if ((await readText(path)) === text) return;
  if (text === undefined) return void (await rm(path, { force: true }));
  const tmp = `${path}.${process.pid}.restore.tmp`;
  try {
    await Bun.write(tmp, text);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Restores every touched file to its pre-apply bytes; the original error always survives. */
async function rollback(err: unknown, before: Map<string, string | undefined>): Promise<Error> {
  const failures: string[] = [];
  for (const [path, text] of before) await restoreText(path, text).catch((e: unknown) => failures.push(`restore ${path}: ${message(e)}`));
  if (!failures.length && err instanceof CliError) return err;
  const suffix = failures.length ? `; rollback failed: ${failures.join("; ")}` : "";
  return new Error(`apply policy: ${message(err)}${suffix}`, { cause: err });
}

/**
 * Under the config lock: load config + manifest, build `next`, plan (pure), check the etag against the plan's
 * (it covers the target settings file, so it needs the plan), then write snapshot → settings → config → manifest.
 * Any failure restores the snapshot, settings and config bytes; the manifest is written last, atomically.
 */
export function applyPolicy(build: ConfigBuild, opts: { expectedEtag?: string } = {}): Promise<PolicyApplyResult> {
  return withConfigLock(async () => {
    const cfgPath = configPath();
    const configText = await readText(cfgPath);
    const config = await loadConfig();
    const manifest = await loadManifest();
    const stateEtag = await currentEtag(config, manifest, configText);
    const next = await build(config, structuredClone(manifest));
    const { plan, write, revert } = await planChange(next, manifest, configText);
    // The state etag (GET, or a previous write) or this plan's etag (a preview of this exact change, which also covers a new target file).
    const expected = opts.expectedEtag;
    if (expected !== undefined && expected !== stateEtag && expected !== plan.etag) throw new StaleConfigError();

    const paths = [plan.compiledPath, revert?.compiledPath, revert?.settingsPath, write?.path, cfgPath].filter((p): p is string => !!p);
    const before = new Map<string, string | undefined>();
    for (const p of new Set(paths)) before.set(p, await readText(p));
    const changes = plan.changes.filter((c) => c.path !== write?.path);
    try {
      if (write) await writeJson(plan.compiledPath, plan.snapshot);
      if (revert) await revertPolicySettings(revert);
      if (revert && !write) await rm(revert.compiledPath, { force: true });
      if (write) {
        const applied = await applyPolicySettings(write.path, write.desired, write.prior);
        changes.push(...applied.changes.map((c) => ({ path: write.path, ...c })));
        manifest.policy = { ...applied.record, compiledPath: plan.compiledPath, appliedAt: new Date().toISOString() };
      } else delete manifest.policy;
      if (JSON.stringify(next) !== JSON.stringify(config)) {
        if (configText !== undefined) await Bun.write(backupPath("config.json"), configText);
        await writeJson(cfgPath, next);
      }
      if (write || revert) await saveManifest(manifest);
    } catch (err) {
      throw await rollback(err, before);
    }
    const etag = await currentEtag(next, manifest);
    return { config: next, plan: { ...plan, changes, etag }, etag };
  });
}
