import { rm } from "node:fs/promises";
import { CliError } from "../cli.error.ts";
import { sha256 } from "../storage/json.file.ts";
import { loadManifest, saveManifest } from "./install.manifest.ts";
import { pruneEmptySections, revertKey } from "./settings.merge.ts";
import { type FileOp, parseSettings, readText, type Target } from "./install.target.ts";

/** Reverts exactly what install wrote; files/keys the user changed since are left alone. */
export async function uninstall(target: Target, opts: { dryRun?: boolean } = {}): Promise<FileOp[]> {
  const manifest = await loadManifest();
  const record = manifest.installs[target.settingsPath];
  if (!record) throw new CliError(`claude-manager is not installed in ${target.scope} scope (${target.settingsPath})`);
  const ops: FileOp[] = [];
  const writes: Array<() => Promise<unknown>> = [];

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

  const raw = await readText(target.settingsPath);
  if (raw !== undefined) {
    const settings = parseSettings(raw, target.settingsPath);
    const keys = Object.keys(record.settings.keys);
    for (const key of keys) revertKey(settings, key, record.settings.keys[key]!);
    const backupRaw = record.settings.backup ? await readText(record.settings.backup) : undefined;
    if (backupRaw !== undefined && Bun.deepEquals(parseSettings(backupRaw, record.settings.backup!), settings)) {
      ops.push({ path: target.settingsPath, op: "restore" });
      writes.push(() => Bun.write(target.settingsPath, backupRaw));
    } else {
      pruneEmptySections(settings, keys);
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
