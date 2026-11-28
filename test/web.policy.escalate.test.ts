import { afterEach, beforeEach, expect, test } from "bun:test";
import { CAPABILITIES } from "../src/policy/policy.presets.ts";
import type { Capability, Decision, PolicyRow } from "../src/server/policy.types.ts";
import { resetSession } from "../src/web/lib/api.write.ts";
import { effectiveLine, isEscalated } from "../src/web/lib/policy.status.ts";
import { setEscalate } from "../src/web/lib/policy.write.ts";
import { auditColumns, originalRule } from "../src/web/components/policy.audit.columns.tsx";
import { DEFAULT_SETUP, formFromConfig } from "../src/web/components/policy.setup.tsx";
import { inputFromConfig } from "../src/web/components/policy.flow.tsx";

const row = (name: string, kind: PolicyRow["kind"], cells: Partial<Record<Capability, Decision>> = {}): PolicyRow => ({
  row: name, kind,
  cells: Object.fromEntries(CAPABILITIES.map((c) => [c, { decision: cells[c] ?? (c === "push" ? "ask" : "default"), source: "preset" }])) as PolicyRow["cells"],
});
const coder = row("coder", "preset", { read: "allow", edit: "allow", test: "allow", git: "ask", shell: "ask", web: "ask" });

test("effectiveLine says asks go to the manager for workers only", () => {
  expect(effectiveLine(coder, "enforced", true)).toBe("Edits + tests · asks manager for shell, web, git · push → owner via manager");
  expect(effectiveLine(coder, "enforced", false)).toBe("Edits + tests · asks shell, web, git · push → owner");
  expect(effectiveLine(row("main", "main", { shell: "ask" }), "enforced", true)).toBe("asks shell · push → owner");
  expect(effectiveLine(row("a", "preset", { read: "allow", push: "deny" }), "enforced", true)).toBe("Reads · push denied");
  expect(isEscalated(row("unknown", "unknown"), true)).toBe(true);
  expect(isEscalated(row("main", "main"), true)).toBe(false);
  expect(isEscalated(coder, undefined)).toBe(false);
});

test("setup defaults to escalate and the input carries it", () => {
  expect(DEFAULT_SETUP.escalate).toBe(true);
  const cfg = { enabled: true, preset: "balanced", scope: "user", overrides: {} } as never;
  expect(inputFromConfig(cfg).escalate).toBe(false);
  expect(formFromConfig({ ...(cfg as object), escalate: true } as never).escalate).toBe(true);
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
