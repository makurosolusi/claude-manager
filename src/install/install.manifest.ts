import { join } from "node:path";
import { appDir } from "../app.paths.ts";
import { readJson, writeJson } from "../storage/json.file.ts";

export type Scope = "user" | "project";

export interface FileRecord {
  sha256: string;
  /** Pre-existing file we replaced; restored on uninstall. */
  backup?: string;
}

export interface KeyRecord {
  /** Value before install; absent = key did not exist. */
  prev?: unknown;
  written: unknown;
}

export interface InstallRecord {
  scope: Scope;
  agentsDir: string;
  settingsPath: string;
  mainAgent?: string;
  files: Record<string, FileRecord>;
  /** backup absent = settings file did not exist before the first install. */
  settings: { backup?: string; keys: Record<string, KeyRecord> };
  installedAt: string;
}

export type PolicyList = "permissions.allow" | "permissions.ask" | "permissions.deny";

export interface PolicyEntry {
  list: PolicyList;
  value: string;
}

/** What the permission policy wrote into one settings file; reverted before the install on uninstall. */
export interface PolicyRecord {
  settingsPath: string;
  /** Copy taken before the first policy write; absent = file did not exist. */
  backup?: string;
  /** Only entries claude-manager added; ones the user already had are never recorded. */
  entries: PolicyEntry[];
  /** The exact PreToolUse group appended; null = none (or the user already had an identical one). */
  hook: { group: unknown } | null;
  /** Scalar keys, e.g. "permissions.defaultMode". */
  keys: Record<string, KeyRecord>;
  compiledPath: string;
  appliedAt: string;
}

export interface Manifest {
  version: 1;
  installs: Record<string, InstallRecord>;
  /** Absent = no policy applied. Optional so v0.3.0 manifests stay valid. */
  policy?: PolicyRecord;
}

const manifestPath = () => join(appDir(), "manifest.json");

export async function loadManifest(): Promise<Manifest> {
  return (await readJson<Manifest>(manifestPath())) ?? { version: 1, installs: {} };
}

export const saveManifest = (m: Manifest) => writeJson(manifestPath(), m);

export function backupPath(name: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(appDir(), "backups", `${stamp}-${crypto.randomUUID().slice(0, 8)}-${name}`);
}
