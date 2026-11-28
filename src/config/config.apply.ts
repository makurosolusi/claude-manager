import { readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CliError } from "../cli.error.ts";
import { install, reapplyAll } from "../install/install.service.ts";
import { backupPath, loadManifest, type Manifest } from "../install/install.manifest.ts";
import { readText } from "../install/install.target.ts";
import { sha256, writeJson } from "../storage/json.file.ts";
import { type Config, configPath, loadConfig } from "./config.store.ts";

/** Config backups kept in the backups dir; older ones are deleted on the next apply. Install backups are never pruned. */
export const MAX_CONFIG_BACKUPS = 20;
const CONFIG_BACKUP_SUFFIX = "-config.json";

/** Optimistic-concurrency failure: config.json changed since the caller read it. The API maps it to 412 (reason stays "conflict"). */
export class StaleConfigError extends CliError {
  constructor() {
    super("config changed outside this page; reload", 1, "conflict");
  }
}

/** sha256 of the config.json text, or "none" when the file does not exist. */
export const configEtag = (text: string | undefined): string => (text === undefined ? "none" : sha256(text));

/** Throws StaleConfigError unless config.json still hashes to `expected`. */
export async function assertEtag(expected: string): Promise<void> {
  if (configEtag(await readText(configPath())) !== expected) throw new StaleConfigError();
}

/** Builds the next config from the freshly loaded one; runs under the config lock. */
export type ConfigBuild = (config: Config, manifest: Manifest) => Config | Promise<Config>;

export interface ApplyOptions {
  /** If-Match etag: checked under the lock, so two writers on the same etag can't both win. */
  expectedEtag?: string;
  /** Return without writing (no backup, no re-apply) when the build changed nothing. */
  skipUnchanged?: boolean;
}

export interface ApplyResult { applied: number; config: Config; etag: string }

// ponytail: in-process lock; cross-process races are caught by the etag
let tail: Promise<unknown> = Promise.resolve();
function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

async function assertNoConflicts(next: Config): Promise<void> {
  const { installs } = await loadManifest();
  const edited: string[] = [];
  const foreign: string[] = [];
  for (const rec of Object.values(installs)) {
    const target = { scope: rec.scope, agentsDir: rec.agentsDir, settingsPath: rec.settingsPath };
    const ops = await install(target, next, { dryRun: true, mainAgent: rec.mainAgent });
    for (const op of ops) if (op.op === "conflict") (rec.files[op.path] ? edited : foreign).push(op.path);
  }
  if (foreign.length) throw new CliError(`${foreign.join(", ")} exists and isn't managed by claude-manager`, 1, "conflict");
  if (edited.length) {
    throw new CliError(
      `these files were edited by hand: ${edited.join(", ")}. Run "claude-manager install --force" to overwrite (a backup is kept).`,
      1,
      "conflict",
    );
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Puts the previous config.json bytes back atomically (tmp + rename), so the etag matches the old one again. */
async function restore(path: string, text: string | undefined): Promise<void> {
  if (text === undefined) return void (await rm(path, { force: true }));
  const tmp = `${path}.${process.pid}.restore.tmp`;
  try {
    await Bun.write(tmp, text);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Restores config.json, then best-effort re-renders every install with the old config; never loses the original error. */
async function rollback(err: unknown, path: string, before: string | undefined, previous: Config): Promise<Error> {
  const failures: string[] = [];
  try {
    await restore(path, before);
    await reapplyAll(previous).catch((e: unknown) => failures.push(`re-apply previous config: ${message(e)}`));
  } catch (e) {
    failures.push(`restore ${path}: ${message(e)}`); // config.json may still hold the new config: don't re-render the old one over it
  }
  if (!failures.length && err instanceof CliError) return err;
  const suffix = failures.length ? `; rollback failed: ${failures.join("; ")}` : "";
  return new Error(`apply config: ${message(err)}${suffix}`, { cause: err });
}

/** Keeps the newest MAX_CONFIG_BACKUPS `*-config.json` backups (names start with an ISO stamp, so they sort by time). */
async function pruneConfigBackups(dir: string): Promise<void> {
  const old = (await readdir(dir)).filter((f) => f.endsWith(CONFIG_BACKUP_SUFFIX)).sort().slice(0, -MAX_CONFIG_BACKUPS);
  await Promise.all(old.map((f) => rm(join(dir, f), { force: true })));
}

/**
 * Under the config lock: check the etag, load config + manifest, build the next config, dry-run (conflict = nothing written),
 * back up config.json, write it atomically, re-render every install, roll back on I/O failure.
 */
export function applyConfig(build: ConfigBuild, opts: ApplyOptions = {}): Promise<ApplyResult> {
  return withConfigLock(async () => {
    const path = configPath();
    const before = await readText(path);
    if (opts.expectedEtag !== undefined && configEtag(before) !== opts.expectedEtag) throw new StaleConfigError();
    const config = await loadConfig();
    const next = await build(config, await loadManifest());
    if (opts.skipUnchanged && JSON.stringify(next) === JSON.stringify(config)) return { applied: 0, config, etag: configEtag(before) };
    await assertNoConflicts(next);
    if (before !== undefined) {
      const backup = backupPath("config.json");
      await Bun.write(backup, before);
      await pruneConfigBackups(dirname(backup));
    }
    try {
      await writeJson(path, next);
      const applied = (await reapplyAll(next)).length;
      return { applied, config: next, etag: configEtag(await readText(path)) };
    } catch (err) {
      throw await rollback(err, path, before, config);
    }
  });
}
