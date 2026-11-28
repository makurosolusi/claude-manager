import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../src/cli.error.ts";
import { StaleConfigError } from "../src/config/config.apply.ts";
import { type Config, configPath, loadConfig } from "../src/config/config.store.ts";
import { loadManifest, saveManifest } from "../src/install/install.manifest.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { uninstall } from "../src/install/uninstall.service.ts";
import { applyPolicy, previewPolicy } from "../src/policy/policy.apply.ts";
import { OWNER_ASK_RULES, PUSH_ALLOW_ERROR, SECRET_DENY_RULES } from "../src/policy/policy.presets.ts";
import {
  applyPreset, DEV_POLICY_ENV, disablePolicy, enablePolicy, HOOK_MATCHER, hookCommand, setCell, setEscalate, setOverrides, setTestCommands,
  SOURCE_HOOK_ERROR,
} from "../src/policy/policy.service.ts";
import { policySnapshotPath as compiledPolicyPath } from "../src/policy/policy.paths.ts";
import { sha256 } from "../src/storage/json.file.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const userSettings = () => join(ctx.claude, "settings.json");
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const balanced = (c: Config) => applyPreset(c, "balanced", "user");
const installUser = async () => install(resolveTarget("user"), await loadConfig());
const reasonOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return { reason: (err as CliError).reason, message: (err as CliError).message };
  }
  throw new Error("expected a CliError");
};

describe("pure transforms", () => {
  test("push allow is always rejected", async () => {
    const config = balanced(await loadConfig());
    expect(await reasonOf(() => setCell(config, "coder", "push", "allow"))).toEqual({ reason: "invalid", message: PUSH_ALLOW_ERROR });
    expect((await reasonOf(() => setOverrides(config, { coder: { push: "allow" } }))).message).toBe(PUSH_ALLOW_ERROR);
    const forged = (c: Config) => ({ ...balanced(c), policy: { ...balanced(c).policy!, overrides: { main: { push: "allow" as const } } } });
    await installUser();
    expect((await reasonOf(() => applyPolicy(forged))).message).toBe(PUSH_ALLOW_ERROR);
    expect(existsSync(configPath())).toBe(false);
  });

  test("setCell: a value equal to the preset drops the override; unknown row is 404", async () => {
    const config = balanced(await loadConfig());
    const set = setCell(config, "coder", "shell", "allow");
    expect(set.policy!.overrides).toEqual({ coder: { shell: "allow" } });
    expect(setCell(set, "coder", "shell", "ask").policy!.overrides).toEqual({});
    expect(setCell(config, "coder", "edit", "default").policy!.overrides).toEqual({ coder: { edit: "default" } });
    expect((await reasonOf(() => setCell(config, "nobody", "edit", "ask"))).reason).toBe("not_found");
    expect((await reasonOf(() => setCell(config, "coder", "fly", "ask"))).reason).toBe("invalid");
    expect(config.policy!.overrides).toEqual({});
  });

  test("applyPreset resets overrides, keeps testCommands; enable/disable need a policy", async () => {
    const base = await loadConfig();
    expect((await reasonOf(() => disablePolicy(base))).reason).toBe("conflict");
    const custom = setTestCommands(setCell(balanced(base), "coder", "shell", "allow"), ["make check"]);
    const reset = applyPreset(custom, "strict", "user");
    expect(reset.policy).toEqual({ enabled: true, preset: "strict", scope: "user", overrides: {}, escalate: true, testCommands: ["make check"] });
    expect((await reasonOf(() => setTestCommands(reset, ["bun test; rm x"]))).reason).toBe("invalid");
    expect(enablePolicy(disablePolicy(reset)).policy).toEqual(reset.policy);
  });

  test("applyPreset keeps escalate: explicit value, else stored value, else on", async () => {
    const base = await loadConfig();
    expect(balanced(base).policy!.escalate).toBe(true); // first setup
    const off = setEscalate(balanced(base), false);
    expect(applyPreset(off, "strict", "user").policy!.escalate).toBe(false); // stored value survives a re-apply
    expect(applyPreset(off, "strict", "user", { escalate: true }).policy!.escalate).toBe(true); // explicit wins
    expect(applyPreset(balanced(base), "strict", "user", { escalate: false }).policy!.escalate).toBe(false);
    const { escalate: _e, ...v040 } = balanced(base).policy!; // v0.4.0 policy: field missing
    expect(applyPreset({ ...base, policy: v040 }, "strict", "user").policy!.escalate).toBe(true);
  });

  test("hook command: compiled binary vs running from source (refused without the dev opt-in, hardened with it)", async () => {
    expect(hookCommand("/opt/bin/claude-manager")).toEqual({ command: "/opt/bin/claude-manager", args: ["hook", "pre-tool-use"] });
    const saved = { node: process.env.NODE_ENV, dev: process.env[DEV_POLICY_ENV] };
    delete process.env.NODE_ENV;
    delete process.env[DEV_POLICY_ENV];
    try {
      expect(await reasonOf(() => hookCommand("/usr/local/bin/bun"))).toEqual({ reason: "conflict", message: SOURCE_HOOK_ERROR });
      const dev = hookCommand("/usr/local/bin/bun", true);
      expect(dev.command).toBe("/usr/local/bin/bun");
      expect(dev.args).toEqual(["--config=/dev/null", "--no-env-file", join(import.meta.dir, "..", "src", "cli.ts"), "hook", "pre-tool-use"]);
      process.env[DEV_POLICY_ENV] = "1";
      expect(hookCommand("/usr/local/bin/bun").args).toEqual(dev.args);
    } finally {
      process.env.NODE_ENV = saved.node;
      if (saved.dev === undefined) delete process.env[DEV_POLICY_ENV];
      else process.env[DEV_POLICY_ENV] = saved.dev;
    }
  });
});

describe("applyPolicy", () => {
  test("409 without an install, nothing written", async () => {
    const err = await reasonOf(() => applyPolicy(balanced));
    expect(err.reason).toBe("conflict");
    expect(err.message).toContain('Run "claude-manager install --scope user" first');
    expect(existsSync(configPath())).toBe(false);
    expect(existsSync(compiledPolicyPath())).toBe(false);
  });

  test("preview equals apply: same changes, same snapshot, and every planned add is on disk", async () => {
    await installUser();
    const preview = await previewPolicy(balanced(await loadConfig()));
    const result = await applyPolicy(balanced, { expectedEtag: preview.etag });
    expect(result.plan.changes).toEqual(preview.changes);
    expect(json(compiledPolicyPath())).toEqual(preview.snapshot!);
    const settings = json(userSettings());
    expect(settings.permissions.ask).toEqual([...OWNER_ASK_RULES]);
    expect(settings.permissions.deny).toEqual([...SECRET_DENY_RULES]);
    expect(settings.permissions.defaultMode).toBeUndefined();
    expect(settings.hooks.PreToolUse).toEqual([preview.hook]);
    expect(preview.hook!.matcher).toBe(HOOK_MATCHER);
    expect(preview.changes.every((c) => c.path === userSettings() && c.op === "add")).toBe(true);
    const manifest = await loadManifest();
    expect(manifest.policy!.compiledPath).toBe(compiledPolicyPath());
    expect(manifest.policy!.hook).toEqual({ group: preview.hook });
    expect(Date.parse(manifest.policy!.appliedAt)).toBeGreaterThan(0);
    expect(result.etag).not.toBe(preview.etag);
  });

  test("re-apply replaces a hook group with an older matcher or older args instead of adding a second one", async () => {
    await installUser();
    await applyPolicy(balanced);
    const settings = json(userSettings());
    const old = { ...settings.hooks.PreToolUse[0], matcher: "Edit|Write|Bash|mcp__.*" };
    writeFileSync(userSettings(), JSON.stringify({ ...settings, hooks: { PreToolUse: [old] } }));
    const manifest = await loadManifest();
    // as recorded by an older version, from a source run: different matcher and args
    manifest.policy!.hook = { group: { ...old, hooks: [{ ...old.hooks[0], args: ["/old/src/cli.ts", "hook", "pre-tool-use"] }] } };
    await saveManifest(manifest);
    await applyPolicy(balanced);
    expect(json(userSettings()).hooks.PreToolUse).toEqual([{ ...old, matcher: HOOK_MATCHER }]);
  });

  test("accept-edits opt-in writes permissions.defaultMode only when asked", async () => {
    await installUser();
    await applyPolicy((c) => applyPreset(c, "balanced", "user", { defaultMode: "acceptEdits" }));
    expect(json(userSettings()).permissions.defaultMode).toBe("acceptEdits");
  });

  test("snapshot owned hashes match the installed agent files", async () => {
    await installUser();
    await applyPolicy(balanced);
    const { owned } = json(compiledPolicyPath());
    const dir = join(ctx.claude, "agents");
    const files = readdirSync(dir).map((f) => join(dir, f));
    expect(Object.keys(owned).sort()).toEqual(files.sort());
    for (const f of files) expect(owned[f]).toBe(sha256(readFileSync(f, "utf8")));
  });

  test("stale etag (settings or config edited after preview) is StaleConfigError", async () => {
    await installUser();
    const { etag } = await previewPolicy(balanced(await loadConfig()));
    writeFileSync(userSettings(), readFileSync(userSettings(), "utf8").replace("{", '{ "theme": "dark",'));
    expect(applyPolicy(balanced, { expectedEtag: etag })).rejects.toBeInstanceOf(StaleConfigError);
    expect(existsSync(compiledPolicyPath())).toBe(false);
  });

  test.skipIf(process.getuid?.() === 0)("write failure (read-only settings dir) rolls everything back", async () => {
    await installUser();
    const files = [configPath(), userSettings(), compiledPolicyPath(), join(ctx.app, "manifest.json")];
    const before = files.map(read);
    chmodSync(ctx.claude, 0o555);
    try {
      const err = await applyPolicy(balanced).then(() => null, (e: Error) => e);
      expect(err?.message).toStartWith("apply policy: write ");
      expect(err?.cause).toBeDefined();
    } finally {
      chmodSync(ctx.claude, 0o755);
    }
    expect(files.map(read)).toEqual(before);
  });

  test("re-apply over a hand-edited hook group replaces it instead of appending", async () => {
    await installUser();
    await applyPolicy(balanced);
    const edited = json(userSettings());
    edited.hooks.PreToolUse[0].hooks[0].timeout = 30;
    writeFileSync(userSettings(), JSON.stringify(edited));
    await applyPolicy(enablePolicy);
    const groups = json(userSettings()).hooks.PreToolUse;
    expect(groups).toHaveLength(1);
    expect(groups[0].hooks[0].timeout).toBe(5);
    const again = await applyPolicy(enablePolicy);
    expect(json(userSettings()).hooks.PreToolUse).toHaveLength(1);
    expect(again.plan.changes.map((c) => c.op)).not.toContain("add");
  });

  test("disable then enable: settings back to the install's bytes, then the same policy again", async () => {
    await installUser();
    const installed = read(userSettings());
    await applyPolicy((c) => setCell(balanced(c), "coder", "shell", "allow"));
    const applied = [read(userSettings()), read(compiledPolicyPath())];
    const off = await applyPolicy(disablePolicy);
    expect(off.plan.changes.every((c) => c.op === "remove")).toBe(true);
    expect(read(userSettings())).toBe(installed);
    expect(existsSync(compiledPolicyPath())).toBe(false);
    expect((await loadManifest()).policy).toBeUndefined();
    expect((await loadConfig()).policy).toMatchObject({ enabled: false, overrides: { coder: { shell: "allow" } } });
    await applyPolicy(enablePolicy);
    expect([read(userSettings()), read(compiledPolicyPath())]).toEqual(applied);
  });

  test("apply then uninstall leaves a pre-existing settings.json byte-identical", async () => {
    mkdirSync(ctx.claude, { recursive: true });
    const original = '{\n  "theme": "dark",\n  "permissions": { "deny": ["Read(**/.env)"], "allow": ["Bash(ls)"] }\n}';
    writeFileSync(userSettings(), original);
    await installUser();
    await applyPolicy(balanced);
    await uninstall(resolveTarget("user"));
    expect(read(userSettings())).toBe(original);
  });

  test("project scope writes settings.local.json at the git root only", async () => {
    const repo = join(ctx.home, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    await install(resolveTarget("project", repo), await loadConfig());
    const committed = join(repo, ".claude", "settings.json");
    const before = read(committed);
    const project = (c: Config) => applyPreset(c, "balanced", "project", { projectDir: repo });
    const { plan } = await applyPolicy(project);
    const local = join(repo, ".claude", "settings.local.json");
    expect(plan.settingsPath).toBe(local);
    expect(json(local).permissions.ask).toEqual([...OWNER_ASK_RULES]);
    expect(read(committed)).toBe(before);
    expect(existsSync(userSettings())).toBe(false);
    expect(json(compiledPolicyPath()).projectDir).toBe(repo);
    const sub = join(repo, "src");
    mkdirSync(sub);
    const err = await reasonOf(() => applyPolicy((c) => applyPreset(c, "balanced", "project", { projectDir: sub })));
    expect(err).toEqual({ reason: "invalid", message: `${sub} is not a git root: project scope policy must live at the repository root` });
  });
});
