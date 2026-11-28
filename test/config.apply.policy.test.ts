import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyConfig } from "../src/config/config.apply.ts";
import { type Config, configPath, loadConfig } from "../src/config/config.store.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { applyPolicy } from "../src/policy/policy.apply.ts";
import { decide, nodePolicyFs, parseSnapshot } from "../src/policy/policy.eval.ts";
import { policySnapshotPath } from "../src/policy/policy.paths.ts";
import { applyPreset } from "../src/policy/policy.service.ts";
import { addRole, setRoleModel } from "../src/roles/roles.service.ts";
import type { AgentInput } from "../src/server/agents.types.ts";
import { sha256 } from "../src/storage/json.file.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
// test-only fixture
const UI_UX: AgentInput = { name: "ui-ux", description: "Designs UI", model: { tier: "work" }, tools: ["Read"] };
/** Rewrites coder.md (owned hash changes) and adds a new role. */
const change = (c: Config) => addRole(setRoleModel(c, "coder", { pin: "claude-x-1" }), UI_UX);
const repo = () => join(ctx.home, "repo");
const agentsDir = () => resolveTarget("project", repo()).agentsDir;
const snapshotText = () => readFileSync(policySnapshotPath(), "utf8");
/** Row + rule the hook gives a worker of `role` running a shell command in the repo. */
const decideFor = (role: string) => {
  const input = { agent_id: "a", agent_type: role, tool_name: "Bash", tool_input: { command: "ls" }, cwd: repo() };
  const { row, rule } = decide(input, parseSnapshot(snapshotText()), nodePolicyFs, { HOME: ctx.home });
  return { row, rule };
};

/** Project install at a git root with a project-scope policy, so the hook's shadow check reads the managed agent files. */
async function setUpPolicy() {
  mkdirSync(join(repo(), ".git"), { recursive: true });
  await install(resolveTarget("project", repo()), await loadConfig());
  await applyPolicy((c) => applyPreset(c, "autonomous", "project", { projectDir: repo() }));
}

describe("applyConfig keeps the policy snapshot in step with the agent files", () => {
  test("policy enabled: changed and new roles get their own row, not unknown/shadowed", async () => {
    await setUpPolicy();
    expect(decideFor("coder").row).toBe("coder");
    expect(decideFor("ui-ux").row).toBe("unknown");
    await applyConfig(change);
    const snap = parseSnapshot(snapshotText());
    for (const name of ["coder.md", "ui-ux.md"]) {
      const file = join(agentsDir(), name);
      expect(snap.owned[file]).toBe(sha256(readFileSync(file, "utf8")));
    }
    expect(Object.keys(snap.matrix)).toContain("ui-ux");
    expect(decideFor("coder")).toEqual({ row: "coder", rule: "role:coder.shell" });
    expect(decideFor("ui-ux")).toEqual({ row: "ui-ux", rule: "role:ui-ux.shell" });
  });

  test("policy disabled: no snapshot is written", async () => {
    await install(resolveTarget("user"), await loadConfig());
    await applyConfig(change);
    expect(existsSync(policySnapshotPath())).toBe(false);
  });

  test("a failing snapshot write rolls back config, agent files and the snapshot", async () => {
    await setUpPolicy();
    const before = { config: readFileSync(configPath(), "utf8"), snapshot: snapshotText() };
    const coder = join(agentsDir(), "coder.md");
    const oldCoder = readFileSync(coder, "utf8");
    // A directory where writeJson puts its tmp file makes the snapshot write fail after the agent files were re-rendered.
    const blocker = `${policySnapshotPath()}.${process.pid}.tmp`;
    mkdirSync(join(blocker, "x"), { recursive: true });
    try {
      const err = await applyConfig(change).then(() => undefined, (e: Error) => e);
      expect(err?.message).toStartWith("apply config: ");
      expect(err?.message).not.toContain("rollback failed");
    } finally {
      rmSync(blocker, { recursive: true, force: true });
    }
    expect(readFileSync(configPath(), "utf8")).toBe(before.config);
    expect(readFileSync(coder, "utf8")).toBe(oldCoder);
    expect(existsSync(join(agentsDir(), "ui-ux.md"))).toBe(false);
    expect(snapshotText()).toBe(before.snapshot);
    expect(decideFor("coder").row).toBe("coder");
  });
});
