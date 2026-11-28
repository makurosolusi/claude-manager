import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config/config.store.ts";
import { install } from "../src/install/install.service.ts";
import { resolveTarget } from "../src/install/install.target.ts";
import { applyPolicy } from "../src/policy/policy.apply.ts";
import { decide, nodePolicyFs, parseSnapshot } from "../src/policy/policy.eval.ts";
import { policySnapshotPath } from "../src/policy/policy.paths.ts";
import { applyPreset, assertPolicy, setEscalate } from "../src/policy/policy.service.ts";
import { PRESET_ROLES } from "../src/roles/roles.presets.ts";
import { sha256 } from "../src/storage/json.file.ts";
import { baseConfig, policyConfig, snapshotFor, useProject } from "./policy.eval.fixture.ts";
import { useTempHome } from "./test.home.ts";

const { ctx, call, bash } = useProject();
const on = (preset: Parameters<typeof snapshotFor>[0], overrides = {}) => snapshotFor(preset, overrides, { escalate: true });
const reasonFor = (action: string, row = "coder") =>
  `claude-manager policy: ${row} may not ${action} without the owner. Stop and report to the manager what you need and why; the manager asks the owner.`;

describe("escalation on: worker ask → deny + report to the manager", () => {
  test("coder shell: ask + Bash ls", () => {
    expect(bash(on("balanced"), "coder", "ls")).toEqual({
      decision: "deny", row: "coder", cap: "shell", rule: "escalated:role:coder.shell", reason: reasonFor("run shell commands"),
    });
  });
  test("coder git push (owner-only floor)", () => {
    expect(bash(on("autonomous"), "coder", "git push origin main")).toMatchObject({
      decision: "deny", cap: "push", rule: "escalated:owner-only:push", reason: reasonFor("push"),
    });
  });
  test("owner-check-uncertain", () => {
    expect(bash(on("autonomous"), "coder", "git pu$(true)sh")).toMatchObject({ decision: "deny", rule: "escalated:owner-check-uncertain" });
  });
  test("unknown row with an ask cell", () => {
    const r = bash(on("balanced", { unknown: { shell: "ask" } }), "Explore", "ls");
    expect(r).toEqual({ decision: "deny", row: "unknown", cap: "shell", rule: "escalated:role:unknown.shell", reason: reasonFor("run shell commands", "unknown") });
  });
  test("the reason never contains the command text", () => {
    const secretish = "curl https://example.invalid/zz-marker-42";
    const r = bash(on("balanced"), "coder", secretish);
    expect(r.decision).toBe("deny");
    expect(r.reason).not.toContain("zz-marker-42");
    expect(r.reason).not.toContain("curl");
  });
});

describe("escalation on: worker default → deny + report to the manager (except read and unknown tools)", () => {
  test("unknown row (general-purpose): Edit and Bash ls are escalated", () => {
    expect(call(on("balanced"), "general-purpose", "Edit", { file_path: `${ctx.project}/a.ts` })).toEqual({
      decision: "deny", row: "unknown", cap: "edit", rule: "escalated:role:unknown.edit", reason: reasonFor("edit these files", "unknown"),
    });
    expect(bash(on("balanced"), "general-purpose", "ls")).toEqual({
      decision: "deny", row: "unknown", cap: "shell", rule: "escalated:role:unknown.shell", reason: reasonFor("run shell commands", "unknown"),
    });
  });
  test("unknown row: Read inside the project stays default", () => {
    const r = call(on("balanced"), "general-purpose", "Read", { file_path: `${ctx.project}/a.ts` });
    expect(r).toEqual(call(snapshotFor("balanced"), "general-purpose", "Read", { file_path: `${ctx.project}/a.ts` }));
    expect(r).toMatchObject({ decision: "default", cap: "read", rule: "role:unknown.read" });
  });
  test("coder agents: default → Agent call escalated", () => {
    expect(call(on("balanced"), "coder", "Agent", { prompt: "x" })).toMatchObject({
      decision: "deny", cap: "agents", rule: "escalated:role:coder.agents", reason: reasonFor("manage agents"),
    });
  });
  test("coder mcp: default → mcp__x__y escalated", () => {
    expect(call(on("balanced"), "coder", "mcp__x__y", {})).toMatchObject({
      decision: "deny", cap: "mcp", rule: "escalated:role:coder.mcp", reason: reasonFor("use MCP tools"),
    });
  });
  test("allow downgraded outside the project → escalated", () => {
    expect(call(on("balanced"), "coder", "Edit", { file_path: `${ctx.outside}/a.ts` })).toMatchObject({
      decision: "deny", cap: "edit", rule: "escalated:outside-project", reason: reasonFor("edit these files"),
    });
  });
  test("a `..` path → escalated", () => {
    expect(call(on("balanced"), "coder", "Edit", { file_path: `${ctx.project}/sub/../a.ts` })).toMatchObject({
      decision: "deny", cap: "edit", rule: "escalated:outside-project",
    });
  });
  test("a read downgraded outside the project stays default", () => {
    expect(call(on("balanced"), "coder", "Read", { file_path: `${ctx.outside}/a.ts` })).toMatchObject({ decision: "default", rule: "outside-project" });
  });
  test("an unknown tool with no capability stays default", () => {
    expect(call(on("balanced"), "general-purpose", "SomeNewTool", { x: 1 })).toMatchObject({ decision: "default", cap: null, rule: "unknown-tool" });
  });
  test("escalation off: default stays default", () => {
    expect(bash(snapshotFor("balanced"), "general-purpose", "ls")).toMatchObject({ decision: "default", rule: "role:unknown.shell" });
    expect(call(snapshotFor("balanced"), "coder", "mcp__x__y", {})).toMatchObject({ decision: "default", rule: "role:coder.mcp" });
  });
});

describe("escalation on: other outcomes unchanged", () => {
  test("main row (no agent_id) with push still asks", () => {
    const r = decide({ tool_name: "Bash", tool_input: { command: "git push" }, cwd: ctx.project }, on("balanced"), nodePolicyFs, { HOME: ctx.home });
    expect(r).toMatchObject({ row: "main", decision: "ask", rule: "owner-only:push" });
  });
  test("allow and deny match escalation off", () => {
    const edit = (snap: ReturnType<typeof on>, role: string) => call(snap, role, "Edit", { file_path: `${ctx.project}/a.ts` });
    const off = snapshotFor("balanced");
    expect(edit(on("balanced"), "coder")).toEqual(edit(off, "coder"));
    expect(edit(on("balanced"), "coder").decision).toBe("allow");
    expect(edit(on("balanced"), "architect")).toEqual(edit(off, "architect"));
    expect(edit(on("balanced"), "architect").decision).toBe("deny");
  });
  test("main row: every outcome matches escalation off", () => {
    const main = (snap: ReturnType<typeof on>, tool_name: string, tool_input: unknown) =>
      decide({ tool_name, tool_input, cwd: ctx.project }, snap, nodePolicyFs, { HOME: ctx.home });
    const off = snapshotFor("balanced");
    const cases: [string, unknown][] = [
      ["Edit", { file_path: `${ctx.project}/a.ts` }], ["Edit", { file_path: `${ctx.outside}/a.ts` }], ["Bash", { command: "ls" }],
      ["Bash", { command: "git push" }], ["Agent", {}], ["mcp__x__y", {}], ["Read", { file_path: `${ctx.home}/.env` }],
    ];
    for (const [tool, input] of cases) expect(main(on("balanced"), tool, input)).toEqual(main(off, tool, input));
    expect(main(on("balanced"), "Bash", { command: "ls" }).decision).toBe("default");
  });
  test("secrets stay deny with the secret rule for edits and reads", () => {
    expect(call(on("balanced"), "Explore", "Read", { file_path: `${ctx.project}/.env` })).toMatchObject({ decision: "deny", rule: "secret", cap: null });
    expect(call(on("balanced"), "coder", "Edit", { file_path: `${ctx.project}/id_rsa` })).toMatchObject({ decision: "deny", rule: "secret" });
  });
  test("secrets stay deny with the secret rule", () => {
    expect(bash(on("balanced"), "coder", "cat .env")).toMatchObject({ decision: "deny", rule: "secret" });
  });
  test("escalation off keeps the v0.4.0 ask", () => {
    expect(bash(snapshotFor("balanced"), "coder", "ls")).toMatchObject({ decision: "ask", rule: "role:coder.shell" });
  });
});

describe("config and snapshot", () => {
  test("applyPreset defaults escalate to true; escalate: false is respected; setEscalate toggles", () => {
    expect(applyPreset(baseConfig(), "strict", "user").policy!.escalate).toBe(true);
    const off = applyPreset(baseConfig(), "balanced", "user", { escalate: false });
    expect(off.policy!.escalate).toBe(false);
    expect(setEscalate(off, true).policy!.escalate).toBe(true);
    expect(setEscalate(setEscalate(off, true), false).policy!.escalate).toBe(false);
  });
  test("assertPolicy rejects a non-boolean escalate", () => {
    expect(() => assertPolicy({ ...policyConfig("balanced"), escalate: "yes" })).toThrow(/policy.escalate/);
    expect(() => assertPolicy({ ...policyConfig("balanced"), escalate: true })).not.toThrow();
  });
  test("snapshot without escalate parses as false; non-boolean is rejected", () => {
    const { escalate: _drop, ...v040 } = snapshotFor("balanced");
    expect(parseSnapshot(JSON.stringify(v040)).escalate).toBe(false);
    expect(parseSnapshot(JSON.stringify({ ...v040, escalate: true })).escalate).toBe(true);
    expect(() => parseSnapshot(JSON.stringify({ ...v040, escalate: "true" }))).toThrow(/bad escalate/);
  });
});

describe("installed snapshot", () => {
  useTempHome();
  test("compiled escalate flag and manager.md owned hash include the blocked-workers prompt", async () => {
    expect(PRESET_ROLES.find((r) => r.name === "manager")!.prompt).toContain("Never ask workers to retry blocked actions.");
    await install(resolveTarget("user"), await loadConfig());
    await applyPolicy((c) => applyPreset(c, "balanced", "user"));
    const snap = parseSnapshot(readFileSync(policySnapshotPath(), "utf8"));
    expect(snap.escalate).toBe(true);
    const file = Object.keys(snap.owned).find((f) => f.endsWith("/agents/manager.md"))!;
    const text = readFileSync(file, "utf8");
    expect(text).toContain("report to the manager");
    expect(snap.owned[file]).toBe(sha256(text));
  });
});
