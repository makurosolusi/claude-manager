import { basename, join } from "node:path";
import { rm } from "node:fs/promises";
import { CliError } from "../cli.error.ts";
import { type Config, TIER_ENV, TIERS } from "../config/config.store.ts";
import { resolveRoles } from "../roles/roles.registry.ts";
import { renderRole } from "../roles/roles.render.ts";
import { sha256 } from "../storage/json.file.ts";
import { backupPath, type InstallRecord, loadManifest, saveManifest } from "./install.manifest.ts";
import { getKey, revertKey, setKey } from "./settings.merge.ts";
import { type FileOp, parseSettings, readText, type Target } from "./install.target.ts";

export interface InstallOptions {
  mainAgent?: string;
  force?: boolean;
  dryRun?: boolean;
}

type Write = () => Promise<unknown>;

function desiredKeys(config: Config, mainAgent?: string): Record<string, unknown> {
  const keys: Record<string, unknown> = {};
  for (const tier of TIERS) keys[`env.${TIER_ENV[tier]}`] = config.tiers[tier];
  if (mainAgent) keys.agent = mainAgent;
  return keys;
}

/** Writes role files + tier env into the target; idempotent, tracked in the manifest. */
export async function install(target: Target, config: Config, opts: InstallOptions = {}): Promise<FileOp[]> {
  const manifest = await loadManifest();
  const prior = manifest.installs[target.settingsPath];
  const roles = resolveRoles(config);
  if (opts.mainAgent && !roles.some((r) => r.name === opts.mainAgent)) {
    throw new CliError(`--main-agent "${opts.mainAgent}" is not an enabled role`);
  }
  const record: InstallRecord = {
    scope: target.scope,
    agentsDir: target.agentsDir,
    settingsPath: target.settingsPath,
    mainAgent: opts.mainAgent,
    files: {},
    settings: { backup: prior?.settings.backup, keys: {} },
    installedAt: new Date().toISOString(),
  };
  const ops: FileOp[] = [];
  const writes: Write[] = [];

  for (const role of roles) {
    const path = join(target.agentsDir, `${role.name}.md`);
    const content = renderRole(role, roles);
    const owned = prior?.files[path];
    const onDisk = await readText(path);
    record.files[path] = { sha256: sha256(content), backup: owned?.backup };
    if (onDisk === undefined) {
      ops.push({ path, op: "create" });
      writes.push(() => Bun.write(path, content));
      continue;
    }
    if (!owned) {
      const conflict = onDisk !== content;
      if (conflict && !opts.force) {
        ops.push({ path, op: "conflict" });
        continue;
      }
      const backup = backupPath(basename(path));
      record.files[path]!.backup = backup;
      ops.push({ path, op: conflict ? "conflict" : "unchanged" });
      writes.push(async () => {
        await Bun.write(backup, onDisk);
        await Bun.write(path, content);
      });
      continue;
    }
    if (onDisk === content) {
      ops.push({ path, op: "unchanged" });
      continue;
    }
    const edited = sha256(onDisk) !== owned.sha256;
    ops.push({ path, op: edited ? "conflict" : "update" });
    if (edited && !opts.force) continue;
    writes.push(async () => {
      // Safety copy of the user's edits; not restored on uninstall (the original backup is).
      if (edited) await Bun.write(backupPath(basename(path)), onDisk);
      await Bun.write(path, content);
    });
  }

  const conflicts = ops.filter((o) => o.op === "conflict").map((o) => o.path);
  if (conflicts.length && !opts.force && !opts.dryRun) {
    throw new CliError(
      `these files exist and are not managed by claude-manager (or were edited):\n  ${conflicts.join("\n  ")}\nRe-run with --force to back them up and overwrite.`,
    );
  }

  for (const [path, rec] of Object.entries(prior?.files ?? {})) {
    if (record.files[path]) continue;
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
  const settings = parseSettings(raw, target.settingsPath);
  const before = JSON.stringify(settings);
  if (!prior && raw !== undefined) {
    const backup = backupPath(`${target.scope}-settings.json`);
    record.settings.backup = backup;
    writes.push(() => Bun.write(backup, raw));
  }
  for (const [key, value] of Object.entries(desiredKeys(config, opts.mainAgent))) {
    const priorKey = prior?.settings.keys[key];
    record.settings.keys[key] = { prev: priorKey ? priorKey.prev : getKey(settings, key), written: value };
    setKey(settings, key, value);
  }
  for (const [key, rec] of Object.entries(prior?.settings.keys ?? {})) {
    if (!record.settings.keys[key]) revertKey(settings, key, rec);
  }
  if (JSON.stringify(settings) !== before || raw === undefined) {
    ops.push({ path: target.settingsPath, op: raw === undefined ? "create" : "update" });
    writes.push(() => Bun.write(target.settingsPath, `${JSON.stringify(settings, null, 2)}\n`));
  } else ops.push({ path: target.settingsPath, op: "unchanged" });

  if (opts.dryRun) return ops;
  for (const write of writes) await write();
  manifest.installs[target.settingsPath] = record;
  await saveManifest(manifest);
  return ops;
}

/** Re-renders every recorded install with the current config (after roles/tier changes). */
export async function reapplyAll(config: Config): Promise<InstallRecord[]> {
  const records = Object.values((await loadManifest()).installs);
  for (const rec of records) {
    const target = { scope: rec.scope, agentsDir: rec.agentsDir, settingsPath: rec.settingsPath };
    await install(target, config, { mainAgent: rec.mainAgent });
  }
  return records;
}
