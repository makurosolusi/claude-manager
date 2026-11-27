import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/config.store.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { uninstall } from "../src/install/uninstall.service.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const settingsFile = () => join(ctx.claude, "settings.json");
const agentsDir = () => join(ctx.claude, "agents");
const readSettings = () => JSON.parse(readFileSync(settingsFile(), "utf8"));

describe("install / uninstall", () => {
  test("fresh install writes 6 roles + tier env, uninstall leaves nothing", async () => {
    const target = resolveTarget("user");
    await install(target, await loadConfig());
    expect(readdirSync(agentsDir()).sort()).toEqual(
      ["architect.md", "coder.md", "manager.md", "researcher.md", "reviewer.md", "writer.md"],
    );
    expect(readSettings().env).toEqual({
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-5-5",
    });
    await uninstall(target);
    expect(readdirSync(agentsDir())).toEqual([]);
    expect(existsSync(settingsFile())).toBe(false);
  });

  test("uninstall restores pre-existing settings byte-for-byte", async () => {
    mkdirSync(ctx.claude, { recursive: true });
    const original = '{"theme":"dark",  "env": {"ANTHROPIC_DEFAULT_OPUS_MODEL":"mine", "FOO":"1"}}';
    writeFileSync(settingsFile(), original);
    const target = resolveTarget("user");
    await install(target, await loadConfig());
    expect(readSettings().env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-opus-5-5");
    expect(readSettings().theme).toBe("dark");
    await install(target, await loadConfig()); // idempotent re-install keeps the original prev value
    await uninstall(target);
    expect(readFileSync(settingsFile(), "utf8")).toBe(original);
  });

  test("user edits after install are preserved by uninstall", async () => {
    const target = resolveTarget("user");
    await install(target, await loadConfig());
    const s = readSettings();
    s.model = "opus";
    s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "user-choice";
    writeFileSync(settingsFile(), JSON.stringify(s));
    await uninstall(target);
    expect(readSettings()).toEqual({ model: "opus", env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "user-choice" } });
  });

  test("foreign agent file is a conflict; --force backs it up and uninstall restores it", async () => {
    mkdirSync(agentsDir(), { recursive: true });
    const foreign = "---\nname: manager\ndescription: mine\n---\nmy own manager\n";
    writeFileSync(join(agentsDir(), "manager.md"), foreign);
    writeFileSync(join(agentsDir(), "mine.md"), "untouched");
    const target = resolveTarget("user");
    await expect(install(target, await loadConfig())).rejects.toThrow("--force");
    expect(existsSync(settingsFile())).toBe(false);
    await install(target, await loadConfig(), { force: true });
    expect(readFileSync(join(agentsDir(), "manager.md"), "utf8")).toContain("manager of a team");
    await uninstall(target);
    expect(readFileSync(join(agentsDir(), "manager.md"), "utf8")).toBe(foreign);
    expect(readFileSync(join(agentsDir(), "mine.md"), "utf8")).toBe("untouched");
  });

  test("edited managed file is kept on uninstall", async () => {
    const target = resolveTarget("user");
    await install(target, await loadConfig());
    writeFileSync(join(agentsDir(), "coder.md"), "my edit");
    const ops = await uninstall(target);
    expect(ops).toContainEqual({ path: join(agentsDir(), "coder.md"), op: "keep-modified" });
    expect(readFileSync(join(agentsDir(), "coder.md"), "utf8")).toBe("my edit");
  });

  test("dry-run writes nothing", async () => {
    const ops = await install(resolveTarget("user"), await loadConfig(), { dryRun: true });
    expect(ops.filter((o) => o.op === "create")).toHaveLength(7);
    expect(existsSync(ctx.claude)).toBe(false);
    expect(existsSync(ctx.app)).toBe(false);
  });

  test("--main-agent sets and reverts the agent key", async () => {
    const target = resolveTarget("user");
    await install(target, await loadConfig(), { mainAgent: "manager" });
    expect(readSettings().agent).toBe("manager");
    await install(target, await loadConfig());
    expect(readSettings().agent).toBeUndefined();
    await expect(install(target, await loadConfig(), { mainAgent: "nope" })).rejects.toThrow("not an enabled role");
  });

  test("project scope writes under ./.claude", async () => {
    const target = resolveTarget("project", ctx.home);
    expect(target.settingsPath).toBe(join(ctx.home, ".claude", "settings.json"));
    expect(() => resolveTarget("global")).toThrow('invalid --scope "global"');
  });

  test("invalid settings.json is reported, not overwritten", async () => {
    mkdirSync(ctx.claude, { recursive: true });
    writeFileSync(settingsFile(), "{ // comment\n}");
    await expect(install(resolveTarget("user"), await loadConfig())).rejects.toThrow("strict JSON");
    expect(readFileSync(settingsFile(), "utf8")).toBe("{ // comment\n}");
  });
});
