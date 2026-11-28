import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CliError } from "../src/cli.error.ts";
import { commands } from "../src/commands/commands.registry.ts";
import { policyCommand } from "../src/commands/policy.command.ts";
import { configPath, loadConfig } from "../src/config/config.store.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { PUSH_ALLOW_ERROR } from "../src/policy/policy.presets.ts";
import { policyAuditFilePath, policySnapshotPath } from "../src/policy/policy.paths.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const settings = () => join(ctx.claude, "settings.json");
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : undefined);
const installUser = async () => void (await install(resolveTarget("user"), await loadConfig()));

async function run(...args: string[]): Promise<{ out: string; code: number }> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await policyCommand.run(args);
    return { out: log.mock.calls.map((c) => String(c[0])).join("\n"), code };
  } finally {
    log.mockRestore();
  }
}
const fail = async (...args: string[]) => {
  try {
    await run(...args);
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return (err as CliError).message;
  }
  throw new Error("expected a CliError");
};
const snapshot = () => JSON.parse(read(policySnapshotPath())!);

describe("policy command", () => {
  test("is registered", () => {
    expect(commands.map((c) => c.name)).toContain("policy");
  });

  test("apply balanced writes settings and snapshot", async () => {
    await installUser();
    const { out, code } = await run("apply", "balanced", "--yes");
    expect(code).toBe(0);
    expect(out).toContain("+ permissions.ask");
    expect(out).toContain(`snapshot: ${policySnapshotPath()}`);
    expect(read(settings())).toContain("hook");
    expect(snapshot().matrix.coder.edit).toBeDefined();
  });

  test("apply without --yes on a non-TTY asks for --yes and writes nothing", async () => {
    await installUser();
    const before = read(settings());
    expect(await fail("apply", "balanced")).toContain("--yes");
    expect(read(settings())).toBe(before);
  });

  test("--dry-run prints the preview and writes nothing", async () => {
    await installUser();
    const before = read(settings());
    const { out } = await run("apply", "strict", "--dry-run");
    expect(out).toContain("Dry run, nothing written.");
    expect(out).toContain("+ permissions.ask");
    expect(read(settings())).toBe(before);
    expect(existsSync(policySnapshotPath())).toBe(false);
    expect((await loadConfig()).policy).toBeUndefined();
  });

  test("set coder edit deny changes the snapshot; push allow exits 1", async () => {
    await installUser();
    await run("apply", "balanced", "--yes");
    await run("set", "coder", "edit", "deny");
    expect(snapshot().matrix.coder.edit).toBe("deny");
    expect((await loadConfig()).policy!.overrides).toEqual({ coder: { edit: "deny" } });
    expect(await fail("set", "coder", "push", "allow")).toBe(PUSH_ALLOW_ERROR);
    expect(snapshot().matrix.coder.push).not.toBe("allow");
  });

  test("disable reverts the settings bytes, enable restores the policy", async () => {
    await installUser();
    const before = read(settings());
    await run("apply", "balanced", "--yes");
    expect(read(settings())).not.toBe(before);
    await run("disable");
    expect(read(settings())).toBe(before);
    expect(existsSync(policySnapshotPath())).toBe(false);
    await run("enable");
    expect(read(settings())).toContain("hook");
  });

  test("show prints each row, preset and override markers", async () => {
    await installUser();
    await run("apply", "balanced", "--yes");
    await run("set", "coder", "edit", "deny");
    const { out } = await run("show");
    expect(out).toContain("policy: enabled  preset: balanced  scope: user");
    expect(out).toContain(`settings: ${settings()}  hook: ok`);
    for (const row of ["main", "coder", "unknown"]) expect(out).toMatch(new RegExp(`^${row}\\s`, "m"));
    expect(out).toMatch(/^coder\s.*deny\*/m);
    const json = JSON.parse((await run("show", "--json")).out);
    expect(json.rows.find((r: { row: string }) => r.row === "coder").cells.edit).toEqual({ decision: "deny", source: "override" });
  });

  test("escalate off/on writes the snapshot, show reports it, a re-apply keeps it", async () => {
    await installUser();
    await run("apply", "balanced", "--yes");
    expect(snapshot().escalate).toBe(true);
    expect((await run("show")).out).toContain("escalate: on\n  worker asks and defaults (except read) go to the manager; only the manager prompts you");
    expect((await run("escalate", "off")).out).toContain("Escalation turned off.");
    expect(snapshot().escalate).toBe(false);
    const off = (await run("show")).out;
    expect(off).toContain("escalate: off");
    expect(off).not.toContain("only the manager prompts you");
    await run("apply", "strict", "--yes");
    expect(snapshot().escalate).toBe(false);
    await run("escalate", "on");
    expect(snapshot().escalate).toBe(true);
  });

  test("apply --no-escalate starts with escalation off; escalate needs a policy and on|off", async () => {
    await installUser();
    expect(await fail("escalate", "off")).toContain("policy apply balanced");
    expect(await fail("escalate", "maybe")).toContain("usage");
    await run("apply", "balanced", "--yes", "--no-escalate");
    expect(snapshot().escalate).toBe(false);
    expect(JSON.parse((await run("show", "--json")).out).policy.escalate).toBe(false);
  });

  test("apply prints the escalate line: first setup, a v0.4.0 policy without the field, and a change", async () => {
    await installUser();
    const first = (await run("apply", "balanced", "--yes")).out;
    expect(first).toContain("escalate: on");
    expect(first).not.toContain("was not set");
    expect(first).toContain("Escalate to manager: on. Change it with: claude-manager policy escalate on|off");
    expect(first.indexOf("escalate: on")).toBeLessThan(first.indexOf("row")); // before the matrix
    const stored = JSON.parse(read(configPath())!);
    delete stored.policy.escalate;
    writeFileSync(configPath(), JSON.stringify(stored));
    const upgrade = await run("apply", "balanced", "--dry-run");
    expect(upgrade.out).toContain("escalate: on (new in 0.4.1; was not set)");
    expect(upgrade.out).not.toContain("Escalate to manager");
    const done = (await run("apply", "balanced", "--yes")).out;
    expect(done).toContain("Escalate to manager: on (new in 0.4.1; was not set).");
    expect(snapshot().escalate).toBe(true);
    expect((await run("apply", "balanced", "--dry-run", "--no-escalate")).out).toContain("escalate: off (was on)");
    await run("escalate", "off");
    expect((await run("apply", "strict", "--dry-run")).out).toContain("escalate: off\n");
    expect((await run("escalate", "on")).out).toContain("escalate: on (was off)");
  });

  test("show before any apply says so", async () => {
    const { out } = await run("show");
    expect(out).toContain("not set up");
  });

  test("bad subcommand and bad arguments are usage errors", async () => {
    expect(await fail("frobnicate")).toContain("unknown policy subcommand");
    expect(await fail()).toContain("Usage: claude-manager policy");
    expect(await fail("apply", "loud", "--yes")).toContain("usage: claude-manager policy apply");
    expect(await fail("set", "coder")).toContain("usage: claude-manager policy set");
  });

  test("without an install, apply tells the user to install", async () => {
    expect(await fail("apply", "balanced", "--yes")).toContain('Run "claude-manager install --scope user"');
    expect(await fail("set", "coder", "edit", "deny")).toContain("policy apply balanced");
  });

  test("audit with no decisions prints an empty message", async () => {
    expect((await run("audit")).out).toContain("no policy decisions since");
  });

  test("audit lists decisions under a note about escalated denies", async () => {
    // test-only fixture event
    const event = { ts: new Date().toISOString(), session_id: "s1", agent_id: "a1", role: "coder", tool: "Edit", cap: "edit", decision: "deny", rule: "escalated:edit", mode: "default" };
    mkdirSync(dirname(policyAuditFilePath()), { recursive: true });
    writeFileSync(policyAuditFilePath(), JSON.stringify(event) + "\n");
    const { out } = await run("audit");
    expect(out.split("\n")[0]).toContain("escalated worker actions are recorded as deny (rule escalated:…); --decision ask won't list them");
    expect(out).toContain("escalated:edit");
    expect((await run("audit", "--since", "1h", "--role", "nobody")).out).not.toContain("note:");
  });

  test("apply from a source run needs --dev-hook or the env opt-in", async () => {
    delete process.env.CLAUDE_MANAGER_DEV_POLICY; // useTempHome restores it after the test
    await installUser();
    expect(await fail("apply", "balanced", "--yes")).toContain("must run from the installed binary");
    expect(read(settings())).not.toContain("pre-tool-use");
    expect((await run("apply", "balanced", "--yes", "--dev-hook")).code).toBe(0);
    expect(read(settings())).toContain("pre-tool-use");
  });
});
