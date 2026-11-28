import { join } from "node:path";
import { rename, rm } from "node:fs/promises";
import { CliError } from "../cli.error.ts";
import { writeJson } from "../storage/json.file.ts";
import { backupPath, type KeyRecord, type PolicyEntry, type PolicyRecord } from "./install.manifest.ts";
import { getKey, revertKey, setKey, type Settings } from "./settings.merge.ts";
import { type FileOp, parseSettings, readText, resolveTarget } from "./install.target.ts";

/** One PreToolUse hook group, per https://code.claude.com/docs/en/hooks (exec form when `args` is set). */
export interface HookGroup {
  matcher: string;
  hooks: { type: "command"; command: string; args?: string[]; timeout?: number }[];
}

/** What the policy wants in the settings file. */
export interface PolicyDesired {
  entries: PolicyEntry[];
  hook: HookGroup | null;
  /** Scalar keys; a key left out is reverted to what it was before the policy. */
  keys: Record<string, unknown>;
}

/** One planned settings change; `keep` = the user already had it, so it is not ours. */
export type ListChange = { op: "add" | "remove" | "keep" | "set"; list?: string; value: unknown };

export type PolicySettingsRecord = Pick<PolicyRecord, "settingsPath" | "backup" | "entries" | "hook" | "keys">;
export type HookRevert = "removed" | "keep-modified" | "missing" | null;

const HOOKS = "hooks.PreToolUse";
const isEmpty = (v: unknown) =>
  Array.isArray(v) ? v.length === 0 : !!v && typeof v === "object" && Object.keys(v).length === 0;

/** User scope shares the install's settings.json; project scope uses the untracked settings.local.json. */
export function policySettingsPath(scope: "user" | "project", projectDir?: string): string {
  if (scope === "user") return resolveTarget("user").settingsPath;
  if (!projectDir) throw new CliError("project scope policy needs a project directory");
  return join(projectDir, ".claude", "settings.local.json");
}

function listAt(obj: Settings, path: string, create: boolean): unknown[] | undefined {
  const value = getKey(obj, path);
  if (Array.isArray(value)) return value;
  if (value !== undefined) throw new CliError(`settings key "${path}" must be an array`);
  if (!create) return undefined;
  setKey(obj, path, []);
  return getKey(obj, path) as unknown[];
}

/** Appends entries the list doesn't hold yet; returns only the ones added. */
export function addEntries(obj: Settings, entries: PolicyEntry[]): PolicyEntry[] {
  const added: PolicyEntry[] = [];
  for (const e of entries) {
    const list = listAt(obj, e.list, true)!;
    if (list.includes(e.value)) continue;
    list.push(e.value);
    added.push(e);
  }
  return added;
}

export function removeEntries(obj: Settings, entries: PolicyEntry[]): void {
  for (const e of entries) {
    const list = listAt(obj, e.list, false);
    const i = list?.indexOf(e.value) ?? -1;
    if (i >= 0) list!.splice(i, 1);
  }
}

/** Appends the group unless an identical one exists; true = appended (and so ours). */
export function addHookGroup(obj: Settings, group: HookGroup): boolean {
  const groups = listAt(obj, HOOKS, true)!;
  if (groups.some((g) => Bun.deepEquals(g, group))) return false;
  groups.push(structuredClone(group));
  return true;
}

/** Removes the group only if unchanged; an edited group (same command + args) is kept and reported. */
export function removeHookGroup(obj: Settings, group: unknown): Exclude<HookRevert, null> {
  const groups = listAt(obj, HOOKS, false) ?? [];
  const i = groups.findIndex((g) => Bun.deepEquals(g, group));
  if (i >= 0) {
    groups.splice(i, 1);
    return "removed";
  }
  const ours = (group as HookGroup).hooks?.[0];
  const edited = groups.some((g) =>
    (g as HookGroup)?.hooks?.some?.((h) => h?.command === ours?.command && Bun.deepEquals(h?.args, ours?.args)),
  );
  return edited ? "keep-modified" : "missing";
}

/** Deletes each path holding an empty list/object; order paths leaf first. */
export function pruneEmpty(obj: Settings, paths: string[]): void {
  for (const path of paths) if (isEmpty(getKey(obj, path))) setKey(obj, path, undefined);
}

/** Pure: applies `desired` onto `settings` (mutated), carrying ownership over from `prior`. */
export function planPolicy(settings: Settings, desired: PolicyDesired, prior?: PolicySettingsRecord) {
  const has = (list: PolicyEntry[] | undefined, e: PolicyEntry) => !!list?.some((p) => p.list === e.list && p.value === e.value);
  const owned = (e: PolicyEntry) => has(prior?.entries, e);
  const changes: ListChange[] = [];
  const stale = prior?.entries.filter((e) => !has(desired.entries, e)) ?? [];
  removeEntries(settings, stale);
  pruneEmpty(settings, [...new Set(stale.map((e) => e.list)), "permissions"]);
  for (const e of stale) changes.push({ op: "remove", list: e.list, value: e.value });

  const entries: PolicyEntry[] = [];
  for (const e of desired.entries) {
    const added = addEntries(settings, [e]).length > 0;
    if (added || owned(e)) entries.push(e);
    changes.push({ op: added ? "add" : owned(e) ? "set" : "keep", list: e.list, value: e.value });
  }

  if (prior?.hook && !Bun.deepEquals(prior.hook.group, desired.hook)) {
    if (removeHookGroup(settings, prior.hook.group) === "removed") changes.push({ op: "remove", list: HOOKS, value: prior.hook.group });
  }
  let hook: PolicyRecord["hook"] = null;
  if (desired.hook) {
    const added = addHookGroup(settings, desired.hook);
    const ours = added || Bun.deepEquals(prior?.hook?.group, desired.hook);
    if (ours) hook = { group: structuredClone(desired.hook) };
    changes.push({ op: added ? "add" : ours ? "set" : "keep", list: HOOKS, value: desired.hook });
  }

  const keys: Record<string, KeyRecord> = {};
  for (const [key, value] of Object.entries(desired.keys)) {
    keys[key] = { prev: prior?.keys[key] ? prior.keys[key]!.prev : getKey(settings, key), written: value };
    setKey(settings, key, value);
    changes.push({ op: "set", list: key, value });
  }
  for (const [key, rec] of Object.entries(prior?.keys ?? {})) if (!keys[key]) revertKey(settings, key, rec);
  return { entries, hook, keys, changes };
}

async function writeTextAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await Bun.write(tmp, text);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw new Error(`write ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Writes the policy into `path` atomically; the first write (no `prior`) backs up the original bytes. */
export async function applyPolicySettings(path: string, desired: PolicyDesired, prior?: PolicySettingsRecord, opts: { dryRun?: boolean } = {}) {
  if (prior && prior.settingsPath !== path) {
    throw new CliError(`policy is applied to ${prior.settingsPath}; revert it before applying to ${path}`);
  }
  const raw = await readText(path);
  const settings = parseSettings(raw, path);
  const before = JSON.stringify(settings);
  const plan = planPolicy(settings, desired, prior);
  const record: PolicySettingsRecord = { settingsPath: path, backup: prior?.backup, entries: plan.entries, hook: plan.hook, keys: plan.keys };
  const changed = JSON.stringify(settings) !== before;
  if (!opts.dryRun && changed) {
    if (!prior && raw !== undefined) {
      record.backup = backupPath("policy-settings.json");
      await Bun.write(record.backup, raw);
    }
    await writeJson(path, settings);
  }
  return { record, changes: plan.changes, changed };
}

/** Reverts what the policy wrote; restores the backup bytes when the result equals it. `text` = resulting file (undefined = none). */
export async function revertPolicySettings(record: PolicySettingsRecord, opts: { dryRun?: boolean } = {}) {
  const path = record.settingsPath;
  const raw = await readText(path);
  if (raw === undefined) return { ops: [] as FileOp[], hook: null as HookRevert, text: undefined };
  const settings = parseSettings(raw, path);
  const original = JSON.stringify(settings);
  removeEntries(settings, record.entries);
  const hook: HookRevert = record.hook ? removeHookGroup(settings, record.hook.group) : null;
  for (const [key, rec] of Object.entries(record.keys)) revertKey(settings, key, rec);

  const ops: FileOp[] = hook === "keep-modified" ? [{ path, op: "keep-modified" }] : [];
  const backupRaw = record.backup ? await readText(record.backup) : undefined;
  const backup = backupRaw === undefined ? undefined : parseSettings(backupRaw, record.backup!);
  const isBackup = () => backup !== undefined && Bun.deepEquals(settings, backup);
  if (!isBackup()) {
    const sections = Object.keys(record.keys).map((k) => k.split(".")[0]!);
    pruneEmpty(settings, [...new Set([...record.entries.map((e) => e.list), "permissions", HOOKS, "hooks", ...sections])]);
  }

  const remove = !isBackup() && !record.backup && Object.keys(settings).length === 0;
  const op = isBackup() ? "restore" : remove ? "remove" : JSON.stringify(settings) === original ? "unchanged" : "update";
  const text = { restore: backupRaw, remove: undefined, unchanged: raw, update: `${JSON.stringify(settings, null, 2)}\n` }[op];
  ops.push({ path, op });
  if (!opts.dryRun && op === "remove") await rm(path, { force: true });
  else if (!opts.dryRun && op !== "unchanged") await writeTextAtomic(path, text!);
  return { ops, hook, text };
}
