import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { CliError } from "../src/cli.error.ts";
import { applyConfig, assertEtag, configEtag, StaleConfigError } from "../src/config/config.apply.ts";
import { configPath, loadConfig, saveConfig } from "../src/config/config.store.ts";
import { addRole, enableRole, removeRole, setTierModel, updateRole } from "../src/roles/roles.service.ts";
import type { AgentInput, AgentPatch } from "../src/server/agents.types.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const agent = (name: string) => join(ctx.claude, "agents", `${name}.md`);
const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};
const input = (over: Partial<AgentInput> = {}): AgentInput => ({
  name: "ui-ux",
  description: "Designs UI layouts",
  model: { tier: "work" },
  tools: ["Read", "Grep"],
  ...over,
});
const reason = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return { message: (err as CliError).message, reason: (err as CliError).reason };
  }
  throw new Error("expected a CliError");
};
/** Installs everywhere and writes config.json so later applies have something to back up. */
const seed = async () => {
  await quiet(["install"]);
  await applyConfig((c) => c);
};
const backups = () => {
  const dir = join(ctx.app, "backups");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("config.json")) : [];
};

describe("service transforms", () => {
  test("addRole returns a new config and rejects duplicates and built-ins", async () => {
    const config = await loadConfig();
    const next = addRole(config, input());
    expect(next.customRoles["ui-ux"]).toMatchObject({ tier: "work", description: "Designs UI layouts", tools: ["Read", "Grep"] });
    expect(config.customRoles["ui-ux"]).toBeUndefined();
    expect(await reason(() => addRole(config, input({ name: "coder" })))).toEqual({ message: 'role "coder" already exists', reason: "conflict" });
    expect(await reason(() => addRole(config, input({ name: "plan" })))).toEqual({ message: '"plan" is a Claude Code built-in agent name', reason: "conflict" });
    expect((await reason(() => addRole(config, input({ description: "  " })))).message).toBe("description is required (Claude uses it to pick the agent)");
  });

  test("addRole with a pin stores the pin as a model override", async () => {
    const next = addRole(await loadConfig(), input({ model: { pin: "claude-haiku-5-5" }, tools: null }));
    expect(next.roleModels["ui-ux"]).toBe("claude-haiku-5-5");
    expect(next.customRoles["ui-ux"]!.tools).toBeUndefined();
  });

  test("400 messages: unknown field, preset restriction, enabled on a custom", async () => {
    const config = addRole(await loadConfig(), input());
    expect(await reason(() => updateRole(config, "ui-ux", { bogus: 1 } as AgentPatch))).toEqual({ message: 'unknown field "bogus"', reason: "invalid" });
    expect(await reason(() => updateRole(config, "coder", { description: "x" }))).toEqual({
      message: "preset agents only allow model and enabled",
      reason: "invalid",
    });
    expect(await reason(() => updateRole(config, "ui-ux", { enabled: false }))).toEqual({
      message: "custom agents have no enabled state; delete it instead",
      reason: "invalid",
    });
    expect((await reason(() => updateRole(config, "nope", {}))).reason).toBe("not_found");
  });

  test("updateRole edits a custom role; a tier edit drops a stale pin", async () => {
    let config = addRole(await loadConfig(), input({ model: { pin: "claude-haiku-5-5" } }));
    config = updateRole(config, "ui-ux", { description: " New ", tools: null, prompt: "Be brief", model: { tier: "think" } });
    expect(config.customRoles["ui-ux"]).toEqual({ tier: "think", description: "New", tools: undefined, prompt: "Be brief" });
    expect(config.roleModels["ui-ux"]).toBeUndefined();
    expect((await reason(() => updateRole(config, "ui-ux", { model: { default: true } }))).message).toContain("only for preset");
  });

  test("disable, enable and delete rules", async () => {
    const config = await loadConfig();
    const manifest = { version: 1 as const, installs: {} };
    const off = updateRole(config, "writer", { enabled: false });
    expect(off.disabledRoles).toContain("writer");
    expect(enableRole(off, "writer").disabledRoles).not.toContain("writer");
    expect(updateRole(config, "writer", { enabled: true })).toEqual(config);
    expect(await reason(() => removeRole(config, "writer", manifest))).toEqual({
      message: `presets can't be deleted; disable it with PATCH {"enabled":false}`,
      reason: "conflict",
    });
    const withCustom = addRole(config, input());
    expect(removeRole(withCustom, "ui-ux", manifest).customRoles).toEqual({});
    const main = { version: 1 as const, installs: { s: { mainAgent: "ui-ux", settingsPath: "/x/settings.json" } as never } };
    expect(await reason(() => removeRole(withCustom, "ui-ux", main))).toEqual({
      message: '"ui-ux" is the main agent at /x/settings.json; re-install without --main-agent first',
      reason: "conflict",
    });
    expect(setTierModel(config, "think", "claude-x-1").tiers.think).toBe("claude-x-1");
  });
});

describe("applyConfig", () => {
  test("adds, updates, disables and deletes through to installed files, with a config backup", async () => {
    await seed();
    const baseline = backups().length;
    let r = await applyConfig((c) => addRole(c, input()));
    expect(r.applied).toBe(1);
    expect(readFileSync(agent("ui-ux"), "utf8")).toContain("Designs UI layouts");
    expect(backups().length).toBe(baseline + 1);
    r = await applyConfig((c) => updateRole(c, "ui-ux", { description: "Polishes UI" }));
    expect(readFileSync(agent("ui-ux"), "utf8")).toContain("Polishes UI");
    await applyConfig((c) => updateRole(c, "writer", { enabled: false }));
    expect(existsSync(agent("writer"))).toBe(false);
    await applyConfig((c) => enableRole(c, "writer"));
    expect(existsSync(agent("writer"))).toBe(true);
    await applyConfig((c, m) => removeRole(c, "ui-ux", m));
    expect(existsSync(agent("ui-ux"))).toBe(false);
    expect(backups().length).toBe(baseline + 5);
  });

  test("a hand-edited file aborts before anything is written", async () => {
    await seed();
    writeFileSync(agent("coder"), "my edits\n");
    const configBefore = readFileSync(configPath(), "utf8");
    const baseline = backups().length;
    const err = await reason(async () => applyConfig((c) => addRole(c, input())));
    expect(err.reason).toBe("conflict");
    expect(err.message).toContain("these files were edited by hand");
    expect(err.message).toContain(agent("coder"));
    expect(readFileSync(configPath(), "utf8")).toBe(configBefore);
    expect(readFileSync(agent("coder"), "utf8")).toBe("my edits\n");
    expect(existsSync(agent("ui-ux"))).toBe(false);
    expect(backups().length).toBe(baseline);
  });

  test("a foreign file with a new role's name is reported as unmanaged", async () => {
    await quiet(["install"]);
    writeFileSync(agent("ui-ux"), "mine\n");
    const err = await reason(async () => applyConfig((c) => addRole(c, input())));
    expect(err).toEqual({ message: `${agent("ui-ux")} exists and isn't managed by claude-manager`, reason: "conflict" });
    expect(readFileSync(agent("ui-ux"), "utf8")).toBe("mine\n");
  });

  test("deleting a custom role restores the user's pre-existing file", async () => {
    await seed();
    await saveConfig(addRole(await loadConfig(), input()));
    writeFileSync(agent("ui-ux"), "original\n");
    await quiet(["install", "--force"]); // adopts the file, backing the original up
    expect(readFileSync(agent("ui-ux"), "utf8")).toContain("Designs UI layouts");
    await applyConfig((c, m) => removeRole(c, "ui-ux", m));
    expect(readFileSync(agent("ui-ux"), "utf8")).toBe("original\n");
  });

  test("a reapply I/O failure restores the previous config and wraps the cause", async () => {
    await seed();
    const before = readFileSync(configPath(), "utf8");
    const dir = join(ctx.claude, "agents");
    chmodSync(dir, 0o555);
    try {
      const err = await applyConfig((c) => addRole(c, input())).then(
        () => undefined,
        (e: Error) => e,
      );
      expect(err?.message).toStartWith("apply config: ");
      expect(err).not.toBeInstanceOf(CliError);
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(readFileSync(configPath(), "utf8")).toBe(before);
    expect(existsSync(agent("ui-ux"))).toBe(false);
  });

  test("concurrent applies are serialized and each builds on the previous result", async () => {
    await seed();
    await Promise.all([
      applyConfig((c) => addRole(c, input({ name: "role-a" }))),
      applyConfig((c) => addRole(c, input({ name: "role-b" }))),
    ]);
    expect(existsSync(agent("role-a"))).toBe(true);
    expect(existsSync(agent("role-b"))).toBe(true);
    expect(Object.keys((await loadConfig()).customRoles).sort()).toEqual(["role-a", "role-b"]);
  });

  test("two applies on the same etag: the etag is checked under the lock, so exactly one wins", async () => {
    await seed();
    const etag = configEtag(readFileSync(configPath(), "utf8"));
    const results = await Promise.allSettled([
      applyConfig((c) => addRole(c, input({ name: "role-a" })), { expectedEtag: etag }),
      applyConfig((c) => addRole(c, input({ name: "role-b" })), { expectedEtag: etag }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(StaleConfigError);
    expect(Object.keys((await loadConfig()).customRoles)).toEqual(["role-a"]);
    expect(existsSync(agent("role-b"))).toBe(false);
  });
});

describe("etag", () => {
  test("configEtag is none for a missing file and assertEtag throws a 412 when stale", async () => {
    expect(configEtag(undefined)).toBe("none");
    await assertEtag("none");
    mkdirSync(ctx.app, { recursive: true });
    writeFileSync(configPath(), "{}\n");
    const etag = configEtag("{}\n");
    await assertEtag(etag);
    writeFileSync(configPath(), '{"storePromptText":false}\n');
    const err = await assertEtag(etag).then(() => undefined, (e: unknown) => e as StaleConfigError);
    expect(err).toBeInstanceOf(StaleConfigError);
    expect(err?.reason).toBe("conflict");
    expect(err?.message).toBe("config changed outside this page; reload");
  });
});
