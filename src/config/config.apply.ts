import { rm } from "node:fs/promises";
import { CliError } from "../cli.error.ts";
import { install, reapplyAll } from "../install/install.service.ts";
import { backupPath, loadManifest } from "../install/install.manifest.ts";
import { readText } from "../install/install.target.ts";
import { sha256, writeJson } from "../storage/json.file.ts";
import { type Config, configPath } from "./config.store.ts";

/** Optimistic-concurrency failure: config.json changed since the caller read it. Maps to HTTP 412 (reason stays "conflict"). */
export class StaleConfigError extends CliError {
  readonly status = 412;
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

async function restore(path: string, text: string | undefined): Promise<void> {
  if (text === undefined) await rm(path, { force: true });
  else await Bun.write(path, text);
}

/**
 * Validates, saves and re-applies a config: dry-run first (conflict = nothing written),
 * back up config.json, write it atomically, re-render every install, roll back on I/O failure.
 * Resolves with the number of installs re-applied.
 */
export function applyConfig(next: Config): Promise<{ applied: number }> {
  return withConfigLock(async () => {
    await assertNoConflicts(next);
    const path = configPath();
    const before = await readText(path);
    if (before !== undefined) await Bun.write(backupPath("config.json"), before);
    try {
      await writeJson(path, next);
      return { applied: (await reapplyAll(next)).length };
    } catch (err) {
      await restore(path, before);
      if (err instanceof CliError) throw err;
      throw new Error(`apply config: ${(err as Error).message}`, { cause: err });
    }
  });
}
