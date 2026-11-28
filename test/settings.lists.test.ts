import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addEntries,
  addHookGroup,
  applyPolicySettings,
  type HookGroup,
  type PolicyDesired,
  policySettingsPath,
  pruneEmpty,
  removeEntries,
  removeHookGroup,
  revertPolicySettings,
} from "../src/install/settings.lists.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const settingsFile = () => join(ctx.claude, "settings.json");
const read = () => readFileSync(settingsFile(), "utf8");
const readJson = () => JSON.parse(read());

// test-only fixtures
const HOOK: HookGroup = {
  matcher: "Edit|Write|NotebookEdit|Bash|WebFetch|WebSearch|Agent|SendMessage|TaskStop|mcp__.*",
  hooks: [{ type: "command", command: "/opt/cm/claude-manager", args: ["hook", "pre-tool-use"], timeout: 5 }],
};
const DESIRED: PolicyDesired = {
  entries: [
    { list: "permissions.ask", value: "Bash(git push *)" },
    { list: "permissions.deny", value: "Read(**/.env)" },
    { list: "permissions.deny", value: "Read(**/*.pem)" },
  ],
  hook: HOOK,
  keys: {},
};

function seed(text: string) {
  mkdirSync(ctx.claude, { recursive: true });
  writeFileSync(settingsFile(), text);
}

describe("settings list helpers (pure)", () => {
  test("addEntries skips values already present and returns only the added ones", () => {
    const s: Record<string, unknown> = { permissions: { deny: ["Read(**/.env)"] } };
    const added = addEntries(s, DESIRED.entries);
    expect(added.map((e) => e.value)).toEqual(["Bash(git push *)", "Read(**/*.pem)"]);
    expect(s).toEqual({ permissions: { deny: ["Read(**/.env)", "Read(**/*.pem)"], ask: ["Bash(git push *)"] } });
    removeEntries(s, added);
    pruneEmpty(s, ["permissions.ask", "permissions"]);
    expect(s).toEqual({ permissions: { deny: ["Read(**/.env)"] } });
  });

  test("addEntries refuses a non-array list", () => {
    expect(() => addEntries({ permissions: { ask: "x" } }, DESIRED.entries)).toThrow('"permissions.ask" must be an array');
  });

  test("hook group: identical group is not added twice; edited group is reported, not removed", () => {
    const s: Record<string, unknown> = {};
    expect(addHookGroup(s, HOOK)).toBe(true);
    expect(addHookGroup(s, HOOK)).toBe(false);
    const edited = structuredClone(HOOK);
    edited.hooks[0]!.timeout = 30;
    const t: Record<string, unknown> = { hooks: { PreToolUse: [edited] } };
    expect(removeHookGroup(t, HOOK)).toBe("keep-modified");
    expect(t).toEqual({ hooks: { PreToolUse: [edited] } });
    expect(removeHookGroup({}, HOOK)).toBe("missing");
    expect(removeHookGroup(s, HOOK)).toBe("removed");
  });
});

describe("apply / revert policy settings", () => {
  test("byte-identical round trip with unusual formatting and other keys", async () => {
    const original =
      '{ "theme":"dark",\n\t"permissions": {"deny":["Read(**/.env)"],  "allow" : ["Bash(ls)"]},\n "hooks":{"Stop":[]}, "zeta": 1 }';
    seed(original);
    const { record, changed } = await applyPolicySettings(settingsFile(), DESIRED);
    expect(changed).toBe(true);
    expect(record.backup).toBeDefined();
    expect(readJson().permissions.deny).toEqual(["Read(**/.env)", "Read(**/*.pem)"]);
    expect(readJson().hooks).toEqual({ Stop: [], PreToolUse: [HOOK] });
    const res = await revertPolicySettings(record);
    expect(res.ops).toEqual([{ path: settingsFile(), op: "restore" }]);
    expect(res.hook).toBe("removed");
    expect(read()).toBe(original);
  });

  test("pre-existing identical entry is not recorded and survives revert", async () => {
    seed('{"permissions":{"deny":["Read(**/.env)"]}}');
    const { record, changes } = await applyPolicySettings(settingsFile(), DESIRED);
    expect(record.entries.map((e) => e.value)).toEqual(["Bash(git push *)", "Read(**/*.pem)"]);
    expect(changes).toContainEqual({ op: "keep", list: "permissions.deny", value: "Read(**/.env)" });
    // A later user edit makes the backup compare fail, so the merge path (not the backup bytes) has to keep the entry.
    writeFileSync(settingsFile(), JSON.stringify({ ...readJson(), theme: "light" }));
    const res = await revertPolicySettings(record);
    expect(res.ops).toEqual([{ path: settingsFile(), op: "update" }]);
    expect(readJson()).toEqual({ permissions: { deny: ["Read(**/.env)"] }, theme: "light" });
  });

  test("hand-edited hook group is kept on revert and reported", async () => {
    const { record } = await applyPolicySettings(settingsFile(), DESIRED);
    const s = readJson();
    s.hooks.PreToolUse[0].hooks[0].timeout = 60;
    writeFileSync(settingsFile(), JSON.stringify(s));
    const res = await revertPolicySettings(record);
    expect(res.hook).toBe("keep-modified");
    expect(res.ops).toContainEqual({ path: settingsFile(), op: "keep-modified" });
    expect(readJson()).toEqual({ hooks: { PreToolUse: [{ ...HOOK, hooks: [{ ...HOOK.hooks[0]!, timeout: 60 }] }] } });
  });

  test("no pre-existing file: apply creates it, revert deletes it", async () => {
    const { record } = await applyPolicySettings(settingsFile(), { ...DESIRED, keys: { "permissions.defaultMode": "acceptEdits" } });
    expect(record.backup).toBeUndefined();
    expect(readJson().permissions.defaultMode).toBe("acceptEdits");
    const res = await revertPolicySettings(record);
    expect(res.ops).toEqual([{ path: settingsFile(), op: "remove" }]);
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("no pre-existing file but the user added a key since: file kept with only that key", async () => {
    const { record } = await applyPolicySettings(settingsFile(), DESIRED);
    writeFileSync(settingsFile(), JSON.stringify({ ...readJson(), theme: "dark" }));
    await revertPolicySettings(record);
    expect(readJson()).toEqual({ theme: "dark" });
  });

  test("idempotent apply: second apply changes nothing and records nothing twice", async () => {
    seed('{"permissions":{"deny":["Read(**/.env)"]}}');
    const first = await applyPolicySettings(settingsFile(), DESIRED);
    const afterFirst = read();
    const second = await applyPolicySettings(settingsFile(), DESIRED, first.record);
    expect(second.changed).toBe(false);
    expect(read()).toBe(afterFirst);
    expect(second.record).toEqual(first.record);
    expect(readJson().hooks.PreToolUse).toHaveLength(1);
    await revertPolicySettings(second.record);
    expect(read()).toBe('{"permissions":{"deny":["Read(**/.env)"]}}');
  });

  test("re-apply with fewer entries removes the dropped ones and keeps ownership of the rest", async () => {
    const first = await applyPolicySettings(settingsFile(), DESIRED);
    const second = await applyPolicySettings(settingsFile(), { ...DESIRED, entries: DESIRED.entries.slice(0, 1) }, first.record);
    expect(second.record.entries).toEqual(DESIRED.entries.slice(0, 1));
    expect(readJson().permissions).toEqual({ ask: ["Bash(git push *)"] });
    expect(second.changes).toContainEqual({ op: "remove", list: "permissions.deny", value: "Read(**/.env)" });
  });

  test("dry run writes nothing", async () => {
    const res = await applyPolicySettings(settingsFile(), DESIRED, undefined, { dryRun: true });
    expect(res.changed).toBe(true);
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("refuses to apply over a record for another file", async () => {
    const { record } = await applyPolicySettings(settingsFile(), DESIRED);
    await expect(applyPolicySettings(join(ctx.home, "other.json"), DESIRED, record)).rejects.toThrow("revert it before");
  });

  test("project scope targets .claude/settings.local.json, never .claude/settings.json", async () => {
    const project = join(ctx.home, "repo");
    const path = policySettingsPath("project", project);
    expect(path).toBe(join(project, ".claude", "settings.local.json"));
    await applyPolicySettings(path, DESIRED);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(project, ".claude", "settings.json"))).toBe(false);
    expect(policySettingsPath("user")).toBe(settingsFile());
  });
});
