import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgentDetail, buildAgents, MAX_AGENTS, type UsageRow } from "../src/agents/agents.catalog.ts";
import { loadConfig, saveConfig } from "../src/config/config.store.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { allRoles, resolveRoles } from "../src/roles/roles.registry.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const cwd = () => join(ctx.home, "proj");
const usage = (role: string, requests: number, rerouted: number): UsageRow =>
  ({ role, requests, cost_usd: 1.5, unpriced: 0, last_ts: "2026-11-28T00:00:00Z", rerouted });
const write = (dir: string, file: string, text: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), text);
};
const byName = async (u: UsageRow[] = []) => {
  const res = await buildAgents(await loadConfig(), u, { cwd: cwd() });
  return { res, get: (n: string) => res.items.find((r) => r.name === n)! };
};

describe("allRoles", () => {
  test("flags disabled; resolveRoles still drops them", async () => {
    const config = await loadConfig();
    config.disabledRoles = ["coder"];
    expect(allRoles(config).find((r) => r.name === "coder")!.disabled).toBe(true);
    expect(resolveRoles(config).some((r) => r.name === "coder")).toBe(false);
    expect(resolveRoles(config)[0]).not.toHaveProperty("disabled");
  });
});

describe("agents catalog kinds", () => {
  test("preset, custom, builtin, plugin and unknown rows", async () => {
    const config = await loadConfig();
    config.customRoles.docs = { tier: "basic", description: "Writes docs", tools: ["Read"], prompt: "Be brief" };
    config.roleModels.coder = "claude-sonnet-4-5";
    config.disabledRoles = ["reviewer"];
    await saveConfig(config);
    const { res, get } = await byName([usage("coder", 4, 1), usage("acme:linter", 2, 0), usage("ghost", 1, 0), usage("main", 9, 0)]);

    expect(get("manager")).toMatchObject({ kind: "preset", source: null, status: "enabled", tier: "think", alias: "opus", model_id: config.tiers.think, scopes: [] });
    expect(get("coder")).toMatchObject({ pin: "claude-sonnet-4-5", model_id: "claude-sonnet-4-5" });
    expect(get("coder").usage).toMatchObject({ requests: 4, rerouted_pct: 25 });
    expect(get("docs")).toMatchObject({ kind: "custom", tools: ["Read"], tier: "basic" });
    expect(get("reviewer").status).toBe("disabled");
    expect(get("Explore")).toMatchObject({ kind: "external", source: "builtin", tier: null });
    expect(get("acme:linter").source).toBe("plugin");
    expect(get("ghost").source).toBe("unknown");
    expect(res.items.some((r) => r.name === "main")).toBe(false);
    expect(res.installed).toBe(false);
    expect(res.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(get("manager").usage.requests).toBe(0);
    expect(get("manager").usage.rerouted_pct).toBe(0);
  });

  test("etag is none without config.json; rerouted_pct is 0 with no rerouted requests", async () => {
    const { res, get } = await byName([usage("coder", 3, 0)]);
    expect(res.etag).toBe("none");
    expect(get("coder").usage.rerouted_pct).toBe(0);
    expect(res.truncated).toBe(false);
    expect(res.items.length).toBeLessThanOrEqual(MAX_AGENTS);
  });
});

describe("external files", () => {
  test("detects a hand-written file and skips manifest files", async () => {
    await install(resolveTarget("user"), await loadConfig());
    write(join(ctx.claude, "agents"), "mine.md", '---\nname: mine\ndescription: "Custom helper"\nmodel: haiku\ntools: Read, Grep\n---\nDo it.\n');
    write(join(ctx.claude, "agents"), "notes.txt", "ignored");
    const { res, get } = await byName();
    expect(get("mine")).toMatchObject({ kind: "external", source: "file", description: "Custom helper", alias: "haiku", tools: ["Read", "Grep"] });
    expect(res.items.filter((r) => r.kind === "external" && r.source === "file").map((r) => r.name)).toEqual(["mine"]);
    const detail = (await buildAgentDetail(await loadConfig(), "mine", [], { cwd: cwd() }))!;
    expect(detail).toMatchObject({ prompt: "Do it.", prompt_source: "file", file_path: join(ctx.claude, "agents", "mine.md") });
  });

  test("oversize file is skipped with a warning; unclosed frontmatter warns on detail", async () => {
    const dir = join(ctx.claude, "agents");
    write(dir, "big.md", "x".repeat(256 * 1024 + 1));
    write(dir, "broken.md", "---\nname: broken\n");
    const { res, get } = await byName();
    expect(get("big")).toBeUndefined();
    expect(res.warnings.join("\n")).toContain("big.md");
    const d = (await buildAgentDetail(await loadConfig(), "broken", [], { cwd: cwd() }))!;
    expect(d.warnings[0]).toContain("not closed");
  });

  test("a directory named x.md and a broken symlink are skipped with a warning, not a 500", async () => {
    const dir = join(ctx.claude, "agents");
    mkdirSync(join(dir, "folder.md"), { recursive: true });
    symlinkSync(join(dir, "gone-target.md"), join(dir, "dangling.md"));
    write(dir, "fine.md", "---\nname: fine\n---\nok\n");
    const { res, get } = await byName();
    expect(get("fine")).toBeDefined();
    expect(get("folder")).toBeUndefined();
    expect(get("dangling")).toBeUndefined();
    const warnings = res.warnings.join("\n");
    expect(warnings).toContain(join(dir, "folder.md"));
    expect(warnings).toContain(join(dir, "dangling.md"));
  });

  test("unknown name has no detail", async () => {
    expect(await buildAgentDetail(await loadConfig(), "nope", [], { cwd: cwd() })).toBeUndefined();
  });
});

describe("scope states", () => {
  test("installed, edited, missing and shadowed; main agent flag", async () => {
    const config = await loadConfig();
    await saveConfig(config);
    await install(resolveTarget("user"), config, { mainAgent: "manager" });
    const agents = join(ctx.claude, "agents");
    writeFileSync(join(agents, "coder.md"), "edited by hand");
    rmSync(join(agents, "reviewer.md"));
    write(join(cwd(), ".claude", "agents"), "architect.md", "---\nname: architect\n---\nproject copy");

    const { res, get } = await byName();
    expect(res.installed).toBe(true);
    expect(get("manager").scopes[0]).toMatchObject({ scope: "user", state: "installed" });
    expect(get("manager").main_agent).toBe(true);
    expect(get("coder").main_agent).toBe(false);
    expect(get("coder").scopes[0]!.state).toBe("edited");
    expect(get("reviewer").scopes[0]!.state).toBe("missing");
    expect(get("architect").scopes[0]!.state).toBe("shadowed");
    expect(res.items.filter((r) => r.name === "architect")).toHaveLength(1);
    const d = (await buildAgentDetail(config, "coder", [], { cwd: cwd() }))!;
    expect(d.warnings.some((w) => w.includes("edited by hand"))).toBe(true);
    expect(d.prompt_source).toBe("default");
  });

  test("disabled role without a record gets no scopes", async () => {
    const config = await loadConfig();
    config.disabledRoles = ["reviewer"];
    await saveConfig(config);
    await install(resolveTarget("user"), config);
    const { get } = await byName();
    expect(get("reviewer")).toMatchObject({ status: "disabled", scopes: [] });
    expect(get("coder").scopes).toHaveLength(1);
  });
});
