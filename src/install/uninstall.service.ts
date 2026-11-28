import { dirname } from "node:path";
import { rm } from "node:fs/promises";
import { CliError } from "../cli.error.ts";
import { sha256 } from "../storage/json.file.ts";
import { loadManifest, saveManifest } from "./install.manifest.ts";
import { pruneEmptySections, revertKey } from "./settings.merge.ts";
import { revertPolicySettings } from "./settings.lists.ts";
import { type FileOp, parseSettings, readText, type Target } from "./install.target.ts";

/**
 * Reverts exactly what install wrote; files/keys the user changed since are left alone.
 * A policy in this scope's .claude dir is reverted first, so the install's compare-with-backup sees the original file.
 */
export async function uninstall(target: Target, opts: { dryRun?: boolean } = {}): Promise<FileOp[]> {
  const manifest = await loadManifest();
  const record = manifest.installs[target.settingsPath];
  if (!record) throw new CliError(`claude-manager is not installed in ${target.scope} scope (${target.settingsPath})`);
  const ops: FileOp[] = [];
  const writes: Array<() => Promise<unknown>> = [];
  let raw = await readText(target.settingsPath);

  const policy = manifest.policy;
  if (policy && dirname(policy.settingsPath) === dirname(target.settingsPath)) {
    const reverted = await revertPolicySettings(policy, opts);
    ops.push(...reverted.ops);
    if (opts.dryRun) {
      if (policy.settingsPath === target.settingsPath) raw = reverted.text;
    } else {
      await rm(policy.compiledPath, { force: true });
      delete manifest.policy;
      await saveManifest(manifest);
      raw = await readText(target.settingsPath);
    }
  }

  for (const [path, rec] of Object.entries(record.files)) {
    const onDisk = await readText(path);
    if (onDisk === undefined) continue;
    if (sha256(onDisk) !== rec.sha256) {
      ops.push({ path, op: "keep-modified" });
      continue;
    }
    ops.push({ path, op: rec.backup ? "restore" : "remove" });
    writes.push(async () => {
      if (rec.backup) await Bun.write(path, Bun.file(rec.backup));
      else await rm(path, { force: true });
    });
  }

  if (raw !== undefined) {
    const settings = parseSettings(raw, target.settingsPath);
    const keys = Object.keys(record.settings.keys);
    for (const key of keys) revertKey(settings, key, record.settings.keys[key]!);
    const backupRaw = record.settings.backup ? await readText(record.settings.backup) : undefined;
    const backup = backupRaw === undefined ? undefined : parseSettings(backupRaw, record.settings.backup!);
    // Compare before and after pruning: a backup without `env` only matches once our emptied `env: {}` is gone,
    // while a backup that itself held an empty `env: {}` only matches before.
    const isBackup = () => backup !== undefined && Bun.deepEquals(backup, settings);
    if (!isBackup()) pruneEmptySections(settings, keys);
    if (isBackup()) {
      ops.push({ path: target.settingsPath, op: "restore" });
      writes.push(() => Bun.write(target.settingsPath, backupRaw!));
    } else {
      const remove = !record.settings.backup && Object.keys(settings).length === 0;
      ops.push({ path: target.settingsPath, op: remove ? "remove" : "update" });
      writes.push(() =>
        remove
          ? rm(target.settingsPath, { force: true })
          : Bun.write(target.settingsPath, `${JSON.stringify(settings, null, 2)}\n`),
      );
    }
  }

  if (opts.dryRun) return ops;
  for (const write of writes) await write();
  delete manifest.installs[target.settingsPath];
  await saveManifest(manifest);
  return ops;
}
