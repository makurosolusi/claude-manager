import { afterEach, describe, expect, test } from "bun:test";
import type { AgentDetail } from "../src/server/agents.types.ts";
import { ApiWriteError, resetSession, sendJson } from "../src/web/lib/api.write.ts";
import { MCP_RE, emptyForm, fieldForError, fromDetail, isDirty, parseMcpList, previewChain, toInput, toPatch, validate, type FormState } from "../src/web/lib/agent.form.ts";

const detail = (o: Partial<AgentDetail> = {}): AgentDetail => ({
  name: "ui-ux", kind: "custom", source: null, status: "enabled", description: "UI work", color: null,
  tier: "work", pin: null, alias: "sonnet", model_id: "claude-sonnet-5-5", tools: ["Read", "mcp__gh__issues"], disallowed_tools: null,
  scopes: [], main_agent: false, usage: { requests: 0, cost_usd: 0, unpriced: 0, last_ts: null, rerouted_pct: null },
  prompt: "Be nice", prompt_source: "config", file_path: null, warnings: [], etag: "e1", ...o,
});
const valid = (o: Partial<FormState> = {}): FormState => ({ ...emptyForm(), name: "ok", description: "does things", ...o });
const create = { isCreate: true, kind: "custom" as const };

describe("validate", () => {
  test("valid form has no errors", () => expect(validate(valid(), create)).toEqual({}));
  test("name rule", () => {
    expect(validate(valid({ name: "Bad_Name" }), create).name).toBe('invalid role name "Bad_Name": use lowercase letters, digits and dashes');
    expect(validate(valid({ name: "a".repeat(41) }), create).name).toBeDefined();
    expect(validate(valid({ name: "a".repeat(40) }), create).name).toBeUndefined();
    expect(validate(valid({ name: "Bad" }), { isCreate: false, kind: "custom" }).name).toBeUndefined();
  });
  test("description required and capped, trimmed", () => {
    expect(validate(valid({ description: "   " }), create).description).toBe("description is required (Claude uses it to pick the agent)");
    expect(validate(valid({ description: "x".repeat(1001) }), create).description).toContain("1000");
    expect(validate(valid({ description: ` ${"x".repeat(1000)} ` }), create).description).toBeUndefined();
  });
  test("pin regex", () => {
    expect(validate(valid({ modelMode: "pin", modelValue: "claude-opus-5-5[1m]" }), create).model).toBeUndefined();
    expect(validate(valid({ modelMode: "pin", modelValue: "bad model!" }), create).model).toBe('invalid model id "bad model!"');
  });
  test("default model only for presets", () => {
    expect(validate(valid({ modelMode: "default" }), create).model).toBeDefined();
    expect(validate(valid({ modelMode: "default" }), { isCreate: false, kind: "preset" }).model).toBeUndefined();
  });
  test("tools only needs 1..64", () => {
    expect(validate(valid({ toolsMode: "only" }), create).tools).toBeDefined();
    expect(validate(valid({ toolsMode: "only", tools: ["Read"] }), create).tools).toBeUndefined();
    expect(validate(valid({ toolsMode: "only", mcp: ["mcp__a"] }), create).tools).toBeUndefined();
    const many = Array.from({ length: 65 }, (_, i) => `Tool${i}`);
    expect(validate(valid({ toolsMode: "only", tools: many }), create).tools).toContain("64");
  });
  test("prompt cap", () => {
    expect(validate(valid({ prompt: "x".repeat(20001) }), create).prompt).toBeDefined();
    expect(validate(valid({ prompt: "x".repeat(20000) }), create).prompt).toBeUndefined();
  });
  test("presets skip non-model fields", () => {
    const bad = valid({ name: "BAD", description: "", prompt: "x".repeat(30000) });
    expect(validate(bad, { isCreate: false, kind: "preset" })).toEqual({});
  });
});

describe("mcp", () => {
  test("regex", () => {
    for (const ok of ["mcp__gh", "mcp__gh__issues", "mcp__gh__*", "mcp__my-srv__do-it"]) expect(MCP_RE.test(ok)).toBe(true);
    for (const bad of ["mcp__", "gh__issues", "mcp__gh__a b", "mcp__gh__a,b", "Read"]) expect(MCP_RE.test(bad)).toBe(false);
  });
  test("validate flags the bad entry", () => {
    expect(validate(valid({ toolsMode: "only", mcp: ["mcp__ok", "nope"] }), create).mcp).toContain('"nope"');
  });
  test("parseMcpList splits commas and newlines, trims, dedupes", () => {
    expect(parseMcpList(" mcp__a, mcp__b\nmcp__a ,\n\n mcp__c ")).toEqual(["mcp__a", "mcp__b", "mcp__c"]);
    expect(parseMcpList("")).toEqual([]);
  });
});

describe("form <-> api shapes", () => {
  test("fromDetail splits mcp and detects modes", () => {
    const s = fromDetail(detail());
    expect(s).toMatchObject({ modelMode: "tier", modelValue: "work", toolsMode: "only", tools: ["Read"], mcp: ["mcp__gh__issues"], prompt: "Be nice" });
    expect(fromDetail(detail({ pin: "opus", tier: null })).modelMode).toBe("pin");
    expect(fromDetail(detail({ tools: null })).toolsMode).toBe("all");
    expect(fromDetail(detail({ prompt: "You are x", prompt_source: "default" })).prompt).toBe("");
  });
  test("toInput", () => {
    expect(toInput(valid({ description: " hi " }))).toEqual({ name: "ok", description: "hi", model: { tier: "work" }, tools: null });
    expect(toInput(valid({ modelMode: "pin", modelValue: "opus", toolsMode: "only", tools: ["Read"], mcp: ["mcp__a"], prompt: "p" })))
      .toEqual({ name: "ok", description: "does things", model: { pin: "opus" }, tools: ["Read", "mcp__a"], prompt: "p" });
  });
  test("toPatch only has changed keys", () => {
    const a = fromDetail(detail());
    expect(toPatch(a, { ...a }, "custom")).toEqual({});
    expect(toPatch(a, { ...a, description: "new" }, "custom")).toEqual({ description: "new" });
    expect(toPatch(a, { ...a, modelMode: "pin", modelValue: "opus" }, "custom")).toEqual({ model: { pin: "opus" } });
    expect(toPatch(a, { ...a, toolsMode: "all" }, "custom")).toEqual({ tools: null });
    expect(toPatch(a, { ...a, prompt: "" }, "custom")).toEqual({ prompt: "" });
  });
  test("preset patch only has model and enabled", () => {
    const a = fromDetail(detail({ kind: "preset" }));
    const p = toPatch(a, { ...a, description: "edited", prompt: "x", modelMode: "default", enabled: false }, "preset");
    expect(p).toEqual({ model: { default: true }, enabled: false });
    expect("description" in toPatch(a, { ...a, description: "edited" }, "preset")).toBe(false);
  });
  test("isDirty", () => {
    const a = fromDetail(detail());
    expect(isDirty(a, { ...a })).toBe(false);
    expect(isDirty(a, { ...a, mcp: [...a.mcp] })).toBe(false);
    expect(isDirty(a, { ...a, prompt: "x" })).toBe(true);
    expect(isDirty(valid({ tools: ["A", "B"] }), valid({ tools: ["B", "A"] }))).toBe(false);
  });
  test("previewChain", () => {
    const tiers = { think: "m-think", work: "m-work", basic: "m-basic" };
    expect(previewChain(valid(), tiers)).toEqual({ tier: "work", pin: null, alias: "sonnet", model_id: "m-work" });
    expect(previewChain(valid({ modelMode: "pin", modelValue: "fable" }), tiers)).toMatchObject({ tier: null, pin: "fable", alias: "fable" });
    expect(previewChain(valid({ modelMode: "default" }), tiers)).toEqual({ tier: null, pin: null, alias: null, model_id: null });
  });
});

describe("fieldForError", () => {
  test.each([
    ["description is required (Claude uses it to pick the agent)", "description"],
    ['invalid role name "X": use lowercase letters, digits and dashes', "name"],
    ['role "x" already exists', "name"],
    ['invalid model id "a b"', "model"],
    ['unknown tool "Foo". Known: Bash (or mcp__*)', "tools"],
    ["prompt is too long", "prompt"],
    ['unknown field "x"', null],
    ["preset agents only allow model and enabled", null],
  ] as const)("%s -> %s", (msg, field) => expect(fieldForError(msg)).toBe(field));
});

describe("sendJson", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; resetSession(); });
  type Call = { url: string; init?: RequestInit };
  const mock = (handler: (c: Call, n: number) => Response) => {
    const calls: Call[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => handler({ url, init }, calls.push({ url, init }))) as unknown as typeof fetch;
    return calls;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const hdr = (c: Call, k: string) => (c.init?.headers as Record<string, string>)[k];

  test("sets token, If-Match and content type", async () => {
    const calls = mock((c) => (c.url === "/api/session" ? json({ write: true, token: "t1" }) : json({ ok: 1 }, 201)));
    expect(await sendJson<{ ok: number }>("POST", "/api/agents", { a: 1 }, "etag1")).toEqual({ ok: 1 });
    const w = calls[1]!;
    expect(w.init?.method).toBe("POST");
    expect(hdr(w, "X-CM-Token")).toBe("t1");
    expect(hdr(w, "If-Match")).toBe("etag1");
    expect(hdr(w, "Content-Type")).toBe("application/json");
    expect(w.init?.body).toBe('{"a":1}');
  });
  test("DELETE has no body or content type", async () => {
    const calls = mock((c) => (c.url === "/api/session" ? json({ write: true, token: "t" }) : json({})));
    await sendJson("DELETE", "/api/agents/x", undefined, "e");
    expect(hdr(calls[1]!, "Content-Type")).toBeUndefined();
    expect(calls[1]!.init?.body).toBeUndefined();
  });
  test("retries once after 403 invalid token with the new token", async () => {
    let token = "old";
    const calls = mock((c) => {
      if (c.url === "/api/session") return json({ write: true, token });
      if (hdr(c, "X-CM-Token") === "old") { token = "new"; return json({ error: "missing or invalid token" }, 403); }
      return json({ done: true });
    });
    expect(await sendJson("PATCH", "/api/agents/x", {}, "e")).toEqual({ done: true });
    expect(calls.map((c) => c.url)).toEqual(["/api/session", "/api/agents/x", "/api/session", "/api/agents/x"]);
    expect(hdr(calls[3]!, "X-CM-Token")).toBe("new");
  });
  test("does not retry twice and error carries status and message", async () => {
    const calls = mock((c) => (c.url === "/api/session" ? json({ write: true, token: "t" }) : json({ error: "missing or invalid token" }, 403)));
    const err = await sendJson("POST", "/api/agents", {}, "e").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiWriteError);
    expect(err).toMatchObject({ method: "POST", path: "/api/agents", status: 403, serverMessage: "missing or invalid token" });
    expect(calls.filter((c) => c.url === "/api/agents")).toHaveLength(2);
  });
  test("other errors do not retry and surface the server message", async () => {
    const calls = mock((c) => (c.url === "/api/session" ? json({ write: true, token: "t" }) : json({ error: "config changed outside this page; reload" }, 412)));
    const err = (await sendJson("PATCH", "/api/agents/x", {}, "e").catch((e: unknown) => e)) as ApiWriteError;
    expect(err.status).toBe(412);
    expect(err.message).toBe("PATCH /api/agents/x failed (412): config changed outside this page; reload");
    expect(calls.filter((c) => c.url === "/api/agents/x")).toHaveLength(1);
  });
});
