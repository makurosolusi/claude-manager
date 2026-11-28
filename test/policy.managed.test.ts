import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blockingKeys, MANAGED_SETTINGS_DIRS, managedSettingsDir, managedSettingsPaths } from "../src/policy/policy.managed.ts";
import { managedBlocks } from "../src/server/policy.api.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();

test("system directory per platform matches the documented paths", () => {
  expect(managedSettingsDir("darwin")).toBe("/Library/Application Support/ClaudeCode");
  expect(managedSettingsDir("linux")).toBe("/etc/claude-code");
  expect(managedSettingsDir("win32")).toBe("C:\\Program Files\\ClaudeCode");
  expect(managedSettingsDir("aix")).toBeUndefined();
  expect(Object.keys(MANAGED_SETTINGS_DIRS)).toHaveLength(3);
});

test("paths: managed-settings.json, then managed-settings.d/*.json alphabetically, hidden and non-json skipped", () => {
  expect(managedSettingsPaths(ctx.home)).toEqual([join(ctx.home, "managed-settings.json")]);
  const d = join(ctx.home, "managed-settings.d");
  mkdirSync(d);
  for (const f of ["20-b.json", "10-a.json", ".hidden.json", "notes.txt"]) writeFileSync(join(d, f), "{}");
  expect(managedSettingsPaths(ctx.home)).toEqual([join(ctx.home, "managed-settings.json"), join(d, "10-a.json"), join(d, "20-b.json")]);
});

test("blockingKeys and managedBlocks see a blocker set in a drop-in file", async () => {
  expect(blockingKeys({ allowManagedHooksOnly: true, disableAllHooks: false, allowManagedPermissionRulesOnly: true })).toEqual([
    "allowManagedHooksOnly", "allowManagedPermissionRulesOnly",
  ]);
  const d = join(ctx.home, "managed-settings.d");
  mkdirSync(d);
  writeFileSync(join(d, "10-sec.json"), JSON.stringify({ disableAllHooks: true }));
  const [reason] = await managedBlocks(managedSettingsPaths(ctx.home));
  expect(reason).toContain("10-sec.json sets disableAllHooks");
});
