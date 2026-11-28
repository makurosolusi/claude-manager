import { afterEach, beforeEach, expect, test } from "bun:test";
import { CAPABILITIES } from "../src/policy/policy.presets.ts";
import type { Capability, Decision, PolicyRow } from "../src/server/policy.types.ts";
import { resetSession } from "../src/web/lib/api.write.ts";
import { effectiveLine, ESCALATE_LEGEND, goesToManager, isEscalated } from "../src/web/lib/policy.status.ts";
import { setEscalate } from "../src/web/lib/policy.write.ts";
import { auditColumns, originalRule } from "../src/web/components/policy.audit.columns.tsx";
import { DEFAULT_SETUP, ESCALATE_HINT, ESCALATE_NEW_HINT, formFromConfig, PolicySummary } from "../src/web/components/policy.setup.tsx";
import { inputFromConfig } from "../src/web/components/policy.flow.tsx";

const row = (name: string, kind: PolicyRow["kind"], cells: Partial<Record<Capability, Decision>> = {}): PolicyRow => ({
  row: name, kind,
  cells: Object.fromEntries(CAPABILITIES.map((c) => [c, { decision: cells[c] ?? (c === "push" ? "ask" : "default"), source: "preset" }])) as PolicyRow["cells"],
});
const coder = row("coder", "preset", { read: "allow", edit: "allow", test: "allow", git: "ask", shell: "ask", web: "ask" });

test("effectiveLine says asks go to the manager for workers only", () => {
  expect(effectiveLine(coder, "enforced", true)).toBe("Edits + tests · asks manager for shell, web, agents, git, MCP · push → owner via manager");
  expect(effectiveLine(coder, "enforced", false)).toBe("Edits + tests · asks shell, web, git · push → owner");
  expect(effectiveLine(row("main", "main", { shell: "ask" }), "enforced", true)).toBe("asks shell · push → owner");
  expect(effectiveLine(row("a", "preset", { read: "allow", push: "deny" }), "enforced", true)).toBe("Reads · asks manager for edits, tests, shell, web, agents, git, MCP · push denied");
  const all = Object.fromEntries(CAPABILITIES.map((c) => [c, "allow"])) as Partial<Record<Capability, Decision>>;
  expect(effectiveLine(row("a", "preset", { ...all, push: "deny" }), "enforced", true)).toBe("Edits + tests + shell + web + agents + git + MCP · push denied");
  expect(isEscalated(row("unknown", "unknown"), true)).toBe(true);
  expect(isEscalated(row("main", "main"), true)).toBe(false);
  expect(isEscalated(coder, undefined)).toBe(false);
});

test("Default cells go to the manager too, except Read; Ask and Default stay separate when escalation is off", () => {
  const w = row("w", "preset", { read: "default", shell: "default", web: "deny", push: "deny" });
  expect(effectiveLine(w, "enforced", true)).toBe("asks manager for edits, tests, shell, agents, git, MCP · no web · push denied");
  expect(effectiveLine(w, "enforced", false)).toBe("no web · push denied");
  expect(goesToManager(w, "shell", "default", true)).toBe(true);
  expect(goesToManager(w, "read", "default", true)).toBe(false);
  expect(goesToManager(w, "read", "ask", true)).toBe(true);
  expect(goesToManager(w, "shell", "allow", true)).toBe(false);
  expect(goesToManager(row("main", "main"), "shell", "default", true)).toBe(false);
  expect(goesToManager(w, "shell", "default", null)).toBe(false);
});

test("setup and Repair: a missing escalate (null) defaults to on in the form and is left out of the input", () => {
  expect(DEFAULT_SETUP.escalate).toBe(true);
  const cfg = { enabled: true, preset: "balanced", scope: "user", overrides: {}, escalate: null } as never;
  expect(inputFromConfig(cfg).escalate).toBeUndefined();
  expect(inputFromConfig({ ...(cfg as object), escalate: false } as never).escalate).toBe(false);
  expect(inputFromConfig({ ...(cfg as object), escalate: true } as never).escalate).toBe(true);
  const form = formFromConfig(cfg);
  expect(form).toMatchObject({ escalate: true, escalateNew: true });
  expect(formFromConfig({ ...(cfg as object), escalate: false } as never)).toMatchObject({ escalate: false, escalateNew: false });
  expect(formFromConfig({ ...(cfg as object), escalate: true } as never).escalate).toBe(true);
});

test("UI copy matches the rule: Ask and Default go to the manager, Read does not", () => {
  expect(ESCALATE_HINT).toBe("Workers don't prompt you for actions marked Ask or Default; they report to the manager, and only the manager asks you. Reads inside the project still follow Claude Code, and tools the policy doesn't model are unaffected.");
  expect(ESCALATE_HINT).not.toContain("never prompt");
  expect(ESCALATE_NEW_HINT).toBe("New in 0.4.1: recommended on");
  expect(ESCALATE_LEGEND).toBe("Ask and Default (except Read) go to the manager; only the manager prompts you.");
});

test("summary says an unset escalation is treated as off", () => {
  const base = { enabled: true, preset: "balanced", scope: "user", overrides: {} };
  const text = (escalate: boolean | null) => JSON.stringify(PolicySummary({ config: { ...base, escalate } as never }));
  expect(text(null)).toContain("Escalation: not set");
  expect(text(false)).not.toContain("not set");
});

test("audit: escalated rows get an Escalated badge and show the original rule", () => {
  expect(originalRule("escalated:preset:coder.shell")).toBe("preset:coder.shell");
  expect(originalRule("preset:coder.shell")).toBe("preset:coder.shell");
  const decision = auditColumns().find((c) => c.id === "decision")!;
  const r = { decision: "deny", rule: "escalated:preset:coder.shell" } as never;
  const el = decision.cell(r) as { props: { r: { rule: string } } };
  expect(el.props.r.rule).toStartWith("escalated:");
});

const realFetch = globalThis.fetch;
const calls: { url: string; init: RequestInit }[] = [];
beforeEach(() => {
  calls.length = 0; resetSession();
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return url === "/api/session" ? Response.json({ token: "tok" }) : Response.json({ etag: "e2" });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; resetSession(); });

test("setEscalate PATCHes /api/policy with If-Match", async () => {
  await setEscalate(false, "E9");
  const w = calls.find((c) => c.url === "/api/policy")!;
  expect(w.init.method).toBe("PATCH");
  expect((w.init.headers as Record<string, string>)["If-Match"]).toBe("E9");
  expect(JSON.parse(w.init.body as string)).toEqual({ escalate: false });
});

test("owner floors copy follows escalation", async () => {
  const { PolicyFloors } = await import("../src/web/components/policy.floors.tsx");
  const on = JSON.stringify(PolicyFloors({ escalate: true }));
  expect(on).toContain("only the manager's session asks you");
  expect(on).not.toContain("Workers always ask you first");
  expect(JSON.stringify(PolicyFloors({ escalate: false }))).toContain("Workers always ask you first");
});
