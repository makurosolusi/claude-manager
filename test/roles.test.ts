import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { loadConfig } from "../src/config/config.store.ts";
import { resolveRoles } from "../src/roles/roles.registry.ts";
import { renderRole } from "../src/roles/roles.render.ts";
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

describe("role rendering", () => {
  test("manager cannot write and lists the team", async () => {
    const roles = resolveRoles(await loadConfig());
    const manager = renderRole(roles.find((r) => r.name === "manager")!, roles);
    const frontmatter = manager.split("---")[1]!;
    expect(frontmatter).toContain("model: opus");
    expect(frontmatter).toMatch(/tools: Agent, Read, Grep, Glob/);
    const tools = frontmatter.match(/^tools: (.*)$/m)![1]!.split(", ");
    for (const banned of ["Edit", "Write", "NotebookEdit", "Bash"]) expect(tools).not.toContain(banned);
    expect(manager).toContain("- **coder** (model: sonnet)");
    expect(manager).not.toContain("{{ROSTER}}");
  });

  test("coder inherits tools except Agent; description is YAML-safe", async () => {
    const roles = resolveRoles(await loadConfig());
    const coder = renderRole(roles.find((r) => r.name === "coder")!, roles);
    expect(coder).toContain("disallowedTools: Agent");
    expect(coder).not.toContain("\ntools:");
    expect(coder).toMatch(/^description: ".*"$/m);
  });
});

describe("roles / tier commands", () => {
  test("tier set re-applies the env of installed scopes", async () => {
    await quiet(["install"]);
    await quiet(["tier", "set", "think", "claude-fable-5-2"]);
    const env = JSON.parse(readFileSync(join(ctx.claude, "settings.json"), "utf8")).env;
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-fable-5-2");
    await expect(run(["tier", "set", "huge", "x"])).rejects.toThrow('unknown tier "huge"');
  });

  test("roles set pins a model or moves a tier", async () => {
    await quiet(["install"]);
    await quiet(["roles", "set", "writer", "work"]);
    expect(readFileSync(agent("writer"), "utf8")).toContain("model: sonnet");
    await quiet(["roles", "set", "writer", "claude-haiku-5-5"]);
    expect(readFileSync(agent("writer"), "utf8")).toContain("model: claude-haiku-5-5");
    await quiet(["roles", "set", "writer", "default"]);
    expect(readFileSync(agent("writer"), "utf8")).toContain("model: haiku");
  });

  test("roles add / rm / enable manage files", async () => {
    await quiet(["install"]);
    await quiet(["roles", "add", "ui-ux", "--tier", "work", "--tools", "Read,Edit", "--description", "UI: layout & a11y"]);
    expect(readFileSync(agent("ui-ux"), "utf8")).toContain("tools: Read, Edit");
    expect(readFileSync(agent("manager"), "utf8")).toContain("**ui-ux**");
    await quiet(["roles", "rm", "ui-ux"]);
    expect(existsSync(agent("ui-ux"))).toBe(false);
    await quiet(["roles", "rm", "writer"]);
    expect(existsSync(agent("writer"))).toBe(false);
    await quiet(["roles", "enable", "writer"]);
    expect(existsSync(agent("writer"))).toBe(true);
  });

  test("roles add validates input", async () => {
    await expect(run(["roles", "add", "Bad Name", "--tier", "work", "--description", "x"])).rejects.toThrow("invalid role name");
    await expect(run(["roles", "add", "x", "--tier", "work", "--description", "x", "--tools", "Bash(ls)x"])).rejects.toThrow("unknown tool");
    await expect(run(["roles", "add", "coder", "--tier", "work", "--description", "x"])).rejects.toThrow("already exists");
    await expect(run(["roles", "add", "x", "--description", "x"])).rejects.toThrow("--tier is required");
  });

  test("main agent role cannot be removed", async () => {
    await quiet(["install", "--main-agent", "manager"]);
    await expect(run(["roles", "rm", "manager"])).rejects.toThrow("main agent");
  });
});
