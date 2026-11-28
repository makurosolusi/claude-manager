import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { installCommand } from "../src/commands/install.command.ts";
import { uninstallCommand } from "../src/commands/uninstall.command.ts";
import { loadConfig } from "../src/config/config.store.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { applyPolicy } from "../src/policy/policy.apply.ts";
import { decide, nodePolicyFs, parseSnapshot } from "../src/policy/policy.eval.ts";
import { policySnapshotPath } from "../src/policy/policy.paths.ts";
import { applyPreset } from "../src/policy/policy.service.ts";
import { sha256 } from "../src/storage/json.file.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const repo = () => join(ctx.home, "repo");
const snapshot = () => parseSnapshot(readFileSync(policySnapshotPath(), "utf8"));
const inRepo = async (fn: () => unknown) => {
  const cwd = process.cwd();
  mkdirSync(join(repo(), ".git"), { recursive: true });
  process.chdir(repo());
  try {
    await fn();
  } finally {
    process.chdir(cwd);
  }
};
const quiet = async (fn: () => unknown) => {
  const log = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
  }
};

describe("install and uninstall keep the policy snapshot in step", () => {
  test("policy enabled: project install adds the new files to owned and coder keeps its own row", async () => {
    await install(resolveTarget("user"), await loadConfig());
    await applyPolicy((c) => applyPreset(c, "autonomous", "user"));
    await inRepo(() => quiet(() => installCommand.run(["--scope", "project"])));
    // Match by suffix: macOS resolves the tmp dir through /private after chdir.
    const file = Object.keys(snapshot().owned).find((f) => f.endsWith("/repo/.claude/agents/coder.md"))!;
    expect(file).toBeDefined();
    expect(snapshot().owned[file]).toBe(sha256(readFileSync(file, "utf8")));
    const input = { agent_id: "a", agent_type: "coder", tool_name: "Bash", tool_input: { command: "ls" }, cwd: realpathSync(repo()) };
    expect(decide(input, snapshot(), nodePolicyFs, { HOME: ctx.home }).row).toBe("coder");
  });

  test("no policy: no snapshot is written", async () => {
    await inRepo(() => quiet(() => installCommand.run(["--scope", "project"])));
    expect(existsSync(policySnapshotPath())).toBe(false);
  });

  test("full uninstall of the policy's scope leaves no snapshot", async () => {
    await install(resolveTarget("user"), await loadConfig());
    await applyPolicy((c) => applyPreset(c, "autonomous", "user"));
    expect(existsSync(policySnapshotPath())).toBe(true);
    await quiet(() => uninstallCommand.run(["--scope", "user"]));
    expect(existsSync(policySnapshotPath())).toBe(false);
  });

  test("uninstalling the project scope while the user policy remains drops its files from owned", async () => {
    await install(resolveTarget("user"), await loadConfig());
    await applyPolicy((c) => applyPreset(c, "autonomous", "user"));
    await inRepo(async () => {
      await quiet(() => installCommand.run(["--scope", "project"]));
      await quiet(() => uninstallCommand.run(["--scope", "project"]));
    });
    expect(Object.keys(snapshot().owned).some((f) => f.includes("/repo/.claude/"))).toBe(false);
  });
});
