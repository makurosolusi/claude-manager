import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkPolicy } from "../src/commands/doctor.policy.ts";
import { loadConfig } from "../src/config/config.store.ts";
import type { PolicyRecord } from "../src/install/install.manifest.ts";
import { effectivePolicy, matrixOf } from "../src/policy/policy.effective.ts";
import { DEV_POLICY_ENV, HOOK_MATCHER } from "../src/policy/policy.service.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const settingsOf = () => join(ctx.claude, "settings.json");
const write = (path: string, data: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
};

function hookGroup(command: string) {
  return { matcher: HOOK_MATCHER, hooks: [{ type: "command", command, args: ["hook", "pre-tool-use"], timeout: 5 }] };
}

/** A healthy applied policy: runnable binary, matching hook, current snapshot. */
async function setup(extra: Record<string, unknown> = {}) {
  const bin = join(ctx.home, "bin", "claude-manager");
  write(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  const group = hookGroup(bin);
  const rec: PolicyRecord = {
    settingsPath: settingsOf(),
    entries: [{ list: "permissions.ask", value: "Bash(git push *)" }],
    hook: { group },
    keys: {},
    compiledPath: join(ctx.app, "policy.compiled.json"),
    appliedAt: "",
  };
  write(settingsOf(), { permissions: { ask: ["Bash(git push *)"] }, hooks: { PreToolUse: [group] }, ...extra });
  const config = await loadConfig();
  const matrix = matrixOf(effectivePolicy(config));
  write(rec.compiledPath, { version: 1, matrix, testCommands: [], ownerOnly: [], owned: {} });
  return { rec, config, bin, matrix };
}

const run = async (s: Awaited<ReturnType<typeof setup>>, execPath = s.bin) =>
  checkPolicy(s.config, s.rec, { cwd: ctx.home, managed: [], execPath });
const labels = (cs: { label: string }[]) => cs.map((c) => c.label).join("\n");

test("no policy: exactly one warn line with the fix command", async () => {
  const cs = await checkPolicy(await loadConfig(), undefined, { cwd: ctx.home, managed: [] });
  expect(cs).toHaveLength(1);
  expect(cs[0]!.ok).toBe("warn");
  expect(cs[0]!.label).toContain('"claude-manager policy apply balanced"');
});

test("healthy policy: every check passes", async () => {
  const cs = await run(await setup());
  expect(cs.map((c) => c.ok)).toEqual([true, true]);
});

test("hook group missing from settings fails", async () => {
  const s = await setup();
  write(settingsOf(), { permissions: { ask: ["Bash(git push *)"] } });
  const cs = await run(s);
  expect(cs.find((c) => c.label.includes("hook missing"))?.ok).toBe(false);
});

test("hook edited (args changed) fails", async () => {
  const s = await setup();
  const edited = hookGroup(s.bin);
  edited.matcher = "*";
  write(settingsOf(), { permissions: { ask: ["Bash(git push *)"] }, hooks: { PreToolUse: [edited] } });
  const c = (await run(s)).find((x) => x.label.includes("edited"));
  expect(c?.ok).toBe(false);
});

test("hook binary path gone fails", async () => {
  const s = await setup();
  const gone = join(ctx.home, "moved", "claude-manager");
  const group = hookGroup(gone);
  s.rec.hook = { group };
  write(settingsOf(), { hooks: { PreToolUse: [group] } });
  const c = (await run(s)).find((x) => x.label.includes("no longer exists"));
  expect(c?.ok).toBe(false);
});

test("hook binary not executable fails; different binary only warns", async () => {
  const s = await setup();
  chmodSync(s.bin, 0o644);
  expect((await run(s)).find((x) => x.label.includes("not executable"))?.ok).toBe(false);
  chmodSync(s.bin, 0o755);
  expect((await run(s, "/other/bin")).find((x) => x.label.includes("not this binary"))?.ok).toBe("warn");
});

test("rule removed by hand warns", async () => {
  const s = await setup();
  write(settingsOf(), { hooks: { PreToolUse: [s.rec.hook!.group] } });
  const c = (await run(s)).find((x) => x.label.includes("removed from"));
  expect(c?.ok).toBe("warn");
});

test("unparseable settings file fails with the parse error", async () => {
  const s = await setup();
  write(settingsOf(), "{ nope");
  const cs = await run(s);
  expect(cs[0]!.ok).toBe(false);
  expect(cs[0]!.label).toContain("cannot parse");
});

test("snapshot missing, invalid and stale all fail; current is ok", async () => {
  const s = await setup();
  writeFileSync(s.rec.compiledPath, "{bad");
  expect((await run(s)).find((x) => x.label.includes("invalid"))?.ok).toBe(false);
  write(s.rec.compiledPath, { version: 1, matrix: { ...s.matrix, coder: { ...s.matrix.coder!, edit: "deny" } }, testCommands: [], ownerOnly: [], owned: {} });
  expect((await run(s)).find((x) => x.label.includes("stale"))?.ok).toBe(false);
  await Bun.file(s.rec.compiledPath).delete();
  expect((await run(s)).find((x) => x.label.includes("missing") && x.label.includes("snapshot"))?.ok).toBe(false);
});

test("defaultMode bypassPermissions warns; acceptEdits and auto are info only", async () => {
  const s = await setup({ permissions: { ask: ["Bash(git push *)"], defaultMode: "bypassPermissions" } });
  const bypass = (await run(s)).find((x) => x.label.includes("bypassPermissions"));
  expect(bypass?.ok).toBe("warn");
  write(settingsOf(), { permissions: { ask: ["Bash(git push *)"], defaultMode: "acceptEdits" }, hooks: { PreToolUse: [s.rec.hook!.group] } });
  const info = (await run(s)).find((x) => x.label.includes("subagent permissionMode is ignored"));
  expect(info?.ok).toBe(true);
  expect(labels(await run(s))).not.toContain("bypassPermissions");
});

test("bare deny on Edit conflicts with a policy edit allow; scoped deny and no deny do not", async () => {
  const s = await setup();
  const editAllowers = Object.entries(s.matrix).filter(([, c]) => c.edit === "allow").map(([r]) => r);
  expect(editAllowers.length).toBeGreaterThan(0);
  const withDeny = (rule: string) =>
    write(settingsOf(), { permissions: { ask: ["Bash(git push *)"], deny: [rule] }, hooks: { PreToolUse: [s.rec.hook!.group] } });
  withDeny("Edit");
  const c = (await run(s)).find((x) => x.label.includes("has no effect"));
  expect(c?.ok).toBe("warn");
  expect(c!.label).toContain(`${editAllowers[0]}.edit`);
  withDeny("Edit(**)");
  expect((await run(s)).some((x) => x.label.includes("has no effect"))).toBe(true);
  withDeny("Edit(src/**)");
  expect((await run(s)).some((x) => x.label.includes("has no effect"))).toBe(false);
});

test("managed settings: absent is silent, present warns softly, blocking hooks fails", async () => {
  const s = await setup();
  const managed = join(ctx.home, "managed-settings.json");
  const missing = await checkPolicy(s.config, s.rec, { cwd: ctx.home, managed: [managed], execPath: s.bin });
  expect(missing).toHaveLength(2);
  write(managed, { model: "x" });
  const soft = (await checkPolicy(s.config, s.rec, { cwd: ctx.home, managed: [managed], execPath: s.bin })).at(-1)!;
  expect(soft.ok).toBe("warn");
  write(managed, { allowManagedHooksOnly: true });
  const hard = (await checkPolicy(s.config, s.rec, { cwd: ctx.home, managed: [managed], execPath: s.bin })).at(-1)!;
  expect(hard.ok).toBe(false);
  expect(hard.label).toContain("allowManagedHooksOnly");
});

/** Runs `fn` with no dev opt-in (bun test sets NODE_ENV=test, which counts as one). */
async function withoutDevOptIn<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { node: process.env.NODE_ENV, dev: process.env[DEV_POLICY_ENV] };
  delete process.env.NODE_ENV;
  delete process.env[DEV_POLICY_ENV];
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = saved.node;
    if (saved.dev !== undefined) process.env[DEV_POLICY_ENV] = saved.dev;
  }
}

test("a source-run hook fails (workers can edit the checkout); with the dev opt-in it only warns", async () => {
  const s = await setup();
  const script = join(ctx.home, "src", "cli.ts");
  write(script, "");
  const group = { ...hookGroup(s.bin), hooks: [{ type: "command", command: s.bin, args: ["--config=/dev/null", "--no-env-file", script, "hook", "pre-tool-use"], timeout: 5 }] };
  s.rec.hook = { group };
  write(settingsOf(), { permissions: { ask: ["Bash(git push *)"] }, hooks: { PreToolUse: [group] } });
  const strict = (await withoutDevOptIn(() => run(s))).find((x) => x.label.includes("source checkout"));
  expect(strict).toEqual({ ok: false, label: expect.stringContaining("Re-apply from the installed binary") });
  expect((await run(s)).find((x) => x.label.includes("source checkout"))?.ok).toBe("warn");
});

test("an applied hook with an older matcher (no Read) fails as out of date", async () => {
  const s = await setup();
  const old = { ...hookGroup(s.bin), matcher: "Edit|Write|NotebookEdit|Bash|WebFetch|WebSearch|Agent|SendMessage|TaskStop|mcp__.*" };
  s.rec.hook = { group: old };
  write(settingsOf(), { permissions: { ask: ["Bash(git push *)"] }, hooks: { PreToolUse: [old] } });
  expect((await run(s)).find((x) => x.label.includes("matcher"))).toEqual({ ok: false, label: expect.stringContaining("out of date") });
});

test("project scope: settings.local.json not gitignored warns, ignored is ok, outside a repo is skipped", async () => {
  const s = await setup();
  const repo = join(ctx.home, "repo");
  const local = join(repo, ".claude", "settings.local.json");
  write(local, { permissions: { ask: ["Bash(git push *)"] }, hooks: { PreToolUse: [s.rec.hook!.group] } });
  s.rec.settingsPath = local;
  const gitCheck = async () => (await run(s)).find((x) => x.label.includes("gitignore"));
  expect(await gitCheck()).toEqual({ ok: true, label: expect.stringContaining("skipped the gitignore check") });
  await Bun.$`git init -q ${repo}`.quiet();
  expect(await gitCheck()).toEqual({ ok: "warn", label: expect.stringContaining("is not gitignored") });
  writeFileSync(join(repo, ".gitignore"), ".claude/settings.local.json\n");
  expect(await gitCheck()).toEqual({ ok: true, label: `${local} is gitignored` });
});
