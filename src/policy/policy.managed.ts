import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Managed-settings facts, verified 2026-11-28 against
 * https://code.claude.com/docs/en/managed-settings ("File-based: `managed-settings.json`, an optional
 * `managed-settings.d/` directory ... in the system directory") and
 * https://code.claude.com/docs/en/settings-reference (`allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`,
 * `disableAllHooks`). MDM profiles, registry values and server-managed settings are not files and are not checked here.
 */
export const MANAGED_SETTINGS_DIRS: Readonly<Record<"darwin" | "linux" | "win32", string>> = {
  darwin: "/Library/Application Support/ClaudeCode",
  linux: "/etc/claude-code", // also WSL
  win32: "C:\\Program Files\\ClaudeCode",
};

/**
 * Keys that, set to `true` in managed settings, make the policy ineffective: user/project hooks don't run
 * (`allowManagedHooksOnly`, `disableAllHooks`) or user/project permission rules are ignored (`allowManagedPermissionRulesOnly`).
 */
export const MANAGED_BLOCKERS = ["allowManagedHooksOnly", "allowManagedPermissionRulesOnly", "disableAllHooks"] as const;

/** The system directory for `platform`; undefined on platforms Claude Code documents no managed file for. */
export const managedSettingsDir = (platform: string = process.platform): string | undefined =>
  MANAGED_SETTINGS_DIRS[platform as keyof typeof MANAGED_SETTINGS_DIRS];

/**
 * Managed files Claude Code merges, in its order: `managed-settings.json`, then `managed-settings.d/*.json`
 * alphabetically, hidden files skipped. Callers check existence; a missing drop-in dir is no drop-ins.
 */
export function managedSettingsPaths(dir = managedSettingsDir()): string[] {
  if (!dir) return [];
  const dropDir = join(dir, "managed-settings.d");
  let drops: string[] = [];
  try {
    drops = readdirSync(dropDir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort().map((f) => join(dropDir, f));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw new Error(`read managed settings dir ${dropDir}: ${(err as Error).message}`, { cause: err });
  }
  return [join(dir, "managed-settings.json"), ...drops];
}

/** Blocker keys `settings` sets to true. */
export const blockingKeys = (settings: Record<string, unknown>): string[] => MANAGED_BLOCKERS.filter((k) => settings[k] === true);
