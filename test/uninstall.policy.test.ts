import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/config.store.ts";
import { loadManifest, saveManifest } from "../src/install/install.manifest.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget, type Target } from "../src/install/install.target.ts";
import { applyPolicySettings, type PolicyDesired, policySettingsPath } from "../src/install/settings.lists.ts";
import { uninstall } from "../src/install/uninstall.service.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const settingsFile = () => join(ctx.claude, "settings.json");

// test-only fixture
const DESIRED: PolicyDesired = {
  entries: [
    { list: "permissions.ask", value: "Bash(git push *)" },
    { list: "permissions.deny", value: "Read(**/.env)" },
  ],
  hook: { matcher: "Bash", hooks: [{ type: "command", command: "/opt/cm/claude-manager", args: ["hook", "pre-tool-use"], timeout: 5 }] },
  keys: {},
};

/** Install, then apply the policy and record it like the apply step will. */
async function setUp(target: Target, policyPath: string) {
  await install(target, await loadConfig());
  const { record } = await applyPolicySettings(policyPath, DESIRED);
  const compiledPath = join(ctx.app, "policy.compiled.json");
  writeFileSync(compiledPath, "{}");
  const manifest = await loadManifest();
  manifest.policy = { ...record, compiledPath, appliedAt: new Date().toISOString() };
  await saveManifest(manifest);
  return compiledPath;
}

describe("uninstall reverts the policy first", () => {
  test("pre-existing settings with your own deny rule: byte-identical after install + policy + uninstall", async () => {
    mkdirSync(ctx.claude, { recursive: true });
    const original = '{\n    "theme": "dark",\n    "permissions": { "deny": ["Read(**/.env)"] },\n    "env": {"FOO": "1"}\n}';
    writeFileSync(settingsFile(), original);
    const target = resolveTarget("user");
    const compiled = await setUp(target, settingsFile());
    const ops = await uninstall(target);
    // Policy restore comes before the install's own settings restore.
    const settingsOps = ops.filter((o) => o.path === settingsFile()).map((o) => o.op);
    expect(settingsOps).toEqual(["restore", "restore"]);
    expect(readFileSync(settingsFile(), "utf8")).toBe(original);
    expect(existsSync(compiled)).toBe(false);
    expect((await loadManifest()).policy).toBeUndefined();
  });

  test("no settings file at the start: it is gone after uninstall", async () => {
    const target = resolveTarget("user");
    await setUp(target, settingsFile());
    await uninstall(target);
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("dry run reports the policy revert and writes nothing", async () => {
    const target = resolveTarget("user");
    await setUp(target, settingsFile());
    const before = readFileSync(settingsFile(), "utf8");
    const ops = await uninstall(target, { dryRun: true });
    expect(ops.filter((o) => o.path === settingsFile()).map((o) => o.op)).toEqual(["restore", "remove"]);
    expect(readFileSync(settingsFile(), "utf8")).toBe(before);
    expect((await loadManifest()).policy).toBeDefined();
  });

  test("project scope: settings.local.json policy is reverted with the project install", async () => {
    const project = join(ctx.home, "repo");
    const target = resolveTarget("project", project);
    const local = policySettingsPath("project", project);
    await setUp(target, local);
    expect(existsSync(local)).toBe(true);
    await uninstall(target);
    expect(existsSync(local)).toBe(false);
    expect(existsSync(target.settingsPath)).toBe(false);
  });

  test("a policy in another scope is left alone", async () => {
    const project = join(ctx.home, "repo");
    const userTarget = resolveTarget("user");
    await setUp(userTarget, settingsFile());
    await install(resolveTarget("project", project), await loadConfig());
    await uninstall(resolveTarget("project", project));
    expect((await loadManifest()).policy).toBeDefined();
    expect(JSON.parse(readFileSync(settingsFile(), "utf8")).permissions.ask).toEqual(["Bash(git push *)"]);
  });
});
