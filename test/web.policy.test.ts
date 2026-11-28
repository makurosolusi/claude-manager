import { afterEach, beforeEach, expect, test } from "bun:test";
import { CAPABILITIES } from "../src/policy/policy.presets.ts";
import type { Capability, Decision } from "../src/policy/policy.types.ts";
import type { PolicyResponse, PolicyRow } from "../src/server/policy.types.ts";
import { resetSession } from "../src/web/lib/api.write.ts";
import {
  countLine, diffToPatches, discardStaging, effectiveLabel, isDirty, newStaging, rowsForDisplay, stageCell, stagedRows, summarizeRow,
} from "../src/web/lib/policy.matrix.ts";
import { driftCause, effectiveLine, needsAttention, policyBanner } from "../src/web/lib/policy.status.ts";
import { applyPatches, applyPreset, disablePolicy, previewPolicy, setCell } from "../src/web/lib/policy.write.ts";

const row = (name: string, kind: PolicyRow["kind"], cells: Partial<Record<Capability, Decision>> = {}, overrides: Capability[] = []): PolicyRow => ({
  row: name, kind,
  cells: Object.fromEntries(CAPABILITIES.map((c) => [c, { decision: cells[c] ?? (c === "push" ? "ask" : "default"), source: overrides.includes(c) ? "override" : "preset" }])) as PolicyRow["cells"],
});
const coder = row("coder", "preset", { read: "allow", edit: "allow", test: "allow", git: "ask", shell: "ask", web: "ask" });
const policy = (status: PolicyResponse["status"], reasons: string[] = []): PolicyResponse =>
  ({ status, reasons, config: null, rows: [], settings_path: null, hook_command: null, installed_scopes: [], warnings: [], audit_summary: [], etag: "e1" });

test("staging: edits dirty, reverting clears, discard resets", () => {
  let s = newStaging([coder]);
  expect(isDirty(s)).toBe(false);
  s = stageCell(s, "coder", "shell", "deny");
  expect(isDirty(s)).toBe(true);
  expect(stagedRows(s)[0]!.cells.shell).toEqual({ decision: "deny", source: "override" });
  s = stageCell(s, "coder", "shell", "ask");
  expect(isDirty(s)).toBe(false);
  expect(isDirty(discardStaging(stageCell(s, "coder", "web", "deny")))).toBe(false);
});

test("diffToPatches emits only changed cells and rows", () => {
  const other = row("writer", "preset", { read: "allow" });
  let s = newStaging([coder, other]);
  s = stageCell(s, "coder", "shell", "deny");
  s = stageCell(s, "coder", "web", "allow");
  expect(diffToPatches(s.initial, stagedRows(s))).toEqual([{ row: "coder", body: { shell: "deny", web: "allow" } }]);
  expect(diffToPatches(s.initial, s.initial)).toEqual([]);
});

test("owner-only allow can never be staged or diffed", () => {
  const s = stageCell(newStaging([coder]), "coder", "push", "allow");
  expect(isDirty(s)).toBe(false);
  const forged = [{ ...coder, cells: { ...coder.cells, push: { decision: "allow" as const, source: "override" as const } } }];
  expect(diffToPatches([coder], forged)).toEqual([]);
  expect(isDirty(stageCell(newStaging([coder]), "ghost", "edit", "deny"))).toBe(false);
});

test("summaries and labels", () => {
  expect(summarizeRow(coder)).toBe("Reads files, edits code, runs tests, asks before shell, web, git, push");
  expect(summarizeRow(row("x", "unknown"))).toBe("Asks before push");
  expect(countLine(coder)).toBe("3 allow · 4 ask");
  expect(effectiveLabel(coder, "edit")).toBe("Allow");
  expect(effectiveLabel(row("c", "custom", { edit: "deny" }, ["edit"]), "edit")).toBe("Deny (edited)");
});

test("rowsForDisplay: main, roles by tier then name, unknown last", () => {
  const rows = [row("unknown", "unknown"), row("zed", "custom"), row("coder", "preset"), row("main", "main"), row("architect", "preset")];
  const names = rowsForDisplay(rows, { architect: "think", coder: "work", zed: "basic" }).map((r) => r.row);
  expect(names).toEqual(["main", "architect", "coder", "zed", "unknown"]);
});

test("policyBanner covers every state", () => {
  expect(policyBanner(null, false)).toBeNull();
  expect(policyBanner(policy("enforced"), false)).toBeNull();
  const setup = policyBanner(policy("not_set_up"), false)!;
  expect(setup.tone).toBe("warning");
  expect(setup.cta).toEqual({ label: "Set up policy", action: "setup", href: "#/policy?setup=1" });
  expect(setup.text).toContain("Workers will ask you for every tool");
  expect(policyBanner(policy("disabled"), false)).toMatchObject({ text: "Policy is off. Workers ask you for every tool.", cta: { label: "Turn on", action: "turn_on" } });
  const drift = policyBanner(policy("drift", ["hook missing from ~/.claude/settings.json."]), false)!;
  expect(drift).toMatchObject({ tone: "error", text: "Policy is set but not enforced: hook missing from ~/.claude/settings.json.", cta: { label: "Repair" } });
  expect(policyBanner(policy("blocked", ["managed settings block hooks"]), false)).toMatchObject({ tone: "info", cta: null, text: "managed settings block hooks" });
  const ro = policyBanner(policy("disabled"), true)!;
  expect(ro.cta).toBeNull();
  expect(ro.hint).toBe("Run: claude-manager policy apply balanced");
  expect(needsAttention(policy("drift"))).toBe(true);
  expect(needsAttention(policy("enforced"))).toBe(false);
});

test("driftCause", () => {
  expect(driftCause(["hook missing from x"])).toBe("hook_missing");
  expect(driftCause(["hook command was edited"])).toBe("hook_edited");
  expect(driftCause(["snapshot is stale"])).toBe("snapshot_stale");
  expect(driftCause([])).toBe("other");
});

test("effectiveLine", () => {
  expect(effectiveLine(coder, "enforced")).toBe("Edits + tests · asks shell, web, git · push → owner");
  expect(effectiveLine(row("main", "main"), "enforced")).toBe("push → owner");
  expect(effectiveLine(row("a", "preset", { read: "allow", edit: "deny", push: "deny" }), "enforced")).toBe("Reads · no edits · push denied");
  expect(effectiveLine(coder, "disabled")).toBe("Off");
  expect(effectiveLine(undefined, "enforced")).toBe("Unknown policy");
});

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls.length = 0;
  resetSession();
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url === "/api/session") return Response.json({ token: "tok" });
    return Response.json({ etag: `e${calls.length}`, policy: {}, changes: [] });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; resetSession(); });
const writes = () => calls.filter((c) => c.url !== "/api/session");
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

test("write wrappers send method, path, If-Match and body", async () => {
  await previewPolicy({ preset: "balanced", scope: "user" }, "E1");
  await applyPreset("strict", "project", "E2");
  await disablePolicy("E3");
  await setCell("my role", { shell: "deny" }, "E4");
  const [prev, put, del, patch] = writes();
  expect([prev!.init.method, prev!.url, hdr(prev!, "If-Match")]).toEqual(["POST", "/api/policy/preview", "E1"]);
  expect([put!.init.method, put!.url, hdr(put!, "If-Match")]).toEqual(["PUT", "/api/policy", "E2"]);
  expect(JSON.parse(put!.init.body as string)).toEqual({ preset: "strict", scope: "project", confirm: true });
  expect([del!.init.method, del!.url, hdr(del!, "If-Match"), del!.init.body]).toEqual(["DELETE", "/api/policy", "E3", undefined]);
  expect([patch!.init.method, patch!.url, hdr(patch!, "If-Match")]).toEqual(["PATCH", "/api/policy/rows/my%20role", "E4"]);
  expect(hdr(patch!, "X-CM-Token")).toBe("tok");
});

test("applyPatches chains the etag from each result", async () => {
  await applyPatches([{ row: "a", body: { web: "deny" } }, { row: "b", body: { edit: "ask" } }], "E0");
  const [first, second] = writes();
  expect(hdr(first!, "If-Match")).toBe("E0");
  expect(hdr(second!, "If-Match")).toMatch(/^e\d+$/);
  expect(await applyPatches([], "E0")).toBeNull();
});

test("summaryLine names preset, scope and Accept edits for the collapsed setup row", async () => {
  const { summaryLine } = await import("../src/web/components/policy.setup.tsx");
  const base = { enabled: true, preset: "balanced", scope: "user", overrides: {}, testCommands: [] } as never;
  expect(summaryLine(base)).toBe("Preset: Balanced · Scope: user · Accept edits: off");
  expect(summaryLine({ ...(base as object), defaultMode: "acceptEdits", scope: "project" } as never)).toBe("Preset: Balanced · Scope: project · Accept edits: on");
});
