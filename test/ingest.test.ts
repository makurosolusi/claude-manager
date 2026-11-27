import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "../src/cli.ts";
import { parseSince } from "../src/commands/stats.command.ts";
import { openDb } from "../src/db/db.schema.ts";
import { usageBy, usageTotal } from "../src/db/stats.repository.ts";
import { sync } from "../src/ingest/ingest.service.ts";
import { DEFAULT_PRICING, ratesFor, requestCost, type Usage } from "../src/ingest/pricing.service.ts";
import { useTempHome } from "./test.home.ts";

// test-only fixtures: synthetic transcripts shaped like Claude Code's JSONL, never real logs.
const ctx = useTempHome();
const SID = "11111111-2222-3333-4444-555555555555";
const ALL = { since: "1970-01-01T00:00:00.000Z" };
let db: Database | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

const mainLog = () => join(ctx.claude, "projects", "-work-app", `${SID}.jsonl`);
const agentLog = (id: string) => join(ctx.claude, "projects", "-work-app", SID, "subagents", `agent-${id}.jsonl`);

let seq = 0;
const entry = (o: Record<string, unknown>) => ({
  sessionId: SID,
  timestamp: new Date(Date.UTC(2026, 10, 20, 10, 0, seq++)).toISOString(),
  uuid: `u-${seq}`,
  cwd: "/work/app",
  gitBranch: "main",
  version: "2.5.0",
  ...o,
});
const assistant = (id: string, model: string, usage: Record<string, unknown>, content: unknown[] = []) =>
  entry({ type: "assistant", requestId: `req-${id}`, message: { id, model, usage, content, stop_reason: "end_turn" } });
const prompt = (text: unknown, o: Record<string, unknown> = {}) =>
  entry({ type: "user", promptId: "p-1", promptSource: "typed", message: { role: "user", content: text }, ...o });

function write(path: string, entries: unknown[], tail = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entries.map((e) => `${JSON.stringify(e)}\n`).join("") + tail);
}
async function synced() {
  db ??= openDb();
  return sync(db);
}
const all = <T>(sql: string) => db!.query<T, []>(sql).all();

describe("pricing", () => {
  const u = (o: Partial<Usage>): Usage => ({ input: 0, cache_5m: 0, cache_1h: 0, cache_read: 0, output: 0, web_search: 0, speed: null, geo: null, ...o });
  const haiku = DEFAULT_PRICING["claude-haiku-5-5"];

  test("haiku long-prompt rates apply only above 100k prompt tokens", () => {
    expect(requestCost(u({ input: 50_000, output: 1000 }), haiku)).toBeCloseTo(0.0055, 10);
    expect(requestCost(u({ input: 60_000, cache_read: 60_000, output: 1000 }), haiku)).toBeCloseTo(0.0355, 10);
  });

  test("cache 5m vs 1h writes, fast mode, US geo and web search", () => {
    const opus = DEFAULT_PRICING["claude-opus-5-5"];
    expect(requestCost(u({ cache_5m: 1e6, cache_1h: 1e6 }), opus)).toBeCloseTo(13, 10);
    expect(requestCost(u({ output: 1e6, speed: "fast" }), opus)).toBeCloseTo(40, 10);
    expect(requestCost(u({ output: 1e6, geo: "us" }), opus)).toBeCloseTo(22, 10);
    expect(requestCost(u({ web_search: 3 }), opus)).toBeCloseTo(0.03, 10);
  });

  test("model lookup strips date and [1m] suffixes but never guesses", () => {
    expect(ratesFor(DEFAULT_PRICING, "claude-haiku-4-5-20251001")).toBe(DEFAULT_PRICING["claude-haiku-4-5"]);
    expect(ratesFor(DEFAULT_PRICING, "claude-opus-4-6[1m]")).toBe(DEFAULT_PRICING["claude-opus-4-6"]);
    expect(ratesFor(DEFAULT_PRICING, "claude-opus-9-9")).toBeUndefined();
  });
});

describe("sync", () => {
  test("dedupes streaming copies, keeps the final usage, records tool calls", async () => {
    write(mainLog(), [
      assistant("msg_1", "claude-opus-5-5", { input_tokens: 10, output_tokens: 5 }, [{ type: "thinking" }]),
      assistant("msg_1", "claude-opus-5-5", { input_tokens: 0, output_tokens: 1e6 }, [
        { type: "tool_use", id: "tu_1", name: "Agent", input: { subagent_type: "coder", model: "haiku" } },
      ]),
    ]);
    const r = await synced();
    expect(r).toMatchObject({ files: 1, changed: 1, newRequests: 1, badLines: 0 });
    expect(all<{ output: number; cost_usd: number }>("SELECT output, cost_usd FROM requests")).toEqual([{ output: 1e6, cost_usd: 20 }]);
    expect(all("SELECT name, subagent_type, model FROM tool_calls")).toEqual([{ name: "Agent", subagent_type: "coder", model: "haiku" }]);
  });

  test("skips <synthetic>, unknown types and tool results; counts broken lines", async () => {
    write(
      mainLog(),
      [
        assistant("msg_s", "<synthetic>", { input_tokens: 0, output_tokens: 0 }),
        entry({ type: "brand-new-entry-type", payload: 1 }),
        entry({ type: "user", toolUseResult: { ok: true }, message: { content: [{ type: "tool_result" }] } }),
        prompt("<command-name>/x</command-name>", { isMeta: true }),
        prompt([{ type: "text", text: "fix the" }, { type: "text", text: "bug" }]),
      ],
      '{"type":"user", broken\n',
    );
    const r = await synced();
    expect(r.newRequests).toBe(0);
    expect(r.badLines).toBe(1);
    expect(all("SELECT source, text FROM prompts")).toEqual([{ source: "typed", text: "fix the\nbug" }]);
    expect(all<{ bad_lines: number }>("SELECT bad_lines FROM files")[0]!.bad_lines).toBe(1);
  });

  test("storePromptText=false keeps prompt metadata only", async () => {
    mkdirSync(ctx.app, { recursive: true });
    writeFileSync(join(ctx.app, "config.json"), JSON.stringify({ storePromptText: false }));
    write(mainLog(), [prompt("secret plan", { origin: { kind: "task-notification" } })]);
    await synced();
    expect(all("SELECT source, text FROM prompts")).toEqual([{ source: "task-notification", text: null }]);
  });

  test("attributes subagent requests via meta.json and the session's main agent", async () => {
    write(mainLog(), [
      entry({ type: "agent-setting", agentSetting: "manager" }),
      entry({ type: "ai-title", aiTitle: "Refactor auth" }),
      assistant("msg_m", "claude-opus-5-5", { input_tokens: 1, output_tokens: 1 }),
    ]);
    write(agentLog("abc"), [{ ...assistant("msg_a", "claude-haiku-5-5", { input_tokens: 1, output_tokens: 1 }), isSidechain: true, cwd: "/work/app/.wt" }]);
    writeFileSync(agentLog("abc").replace(".jsonl", ".meta.json"), JSON.stringify({ agentType: "coder", description: "write code", spawnDepth: 1 }));
    write(join(dirname(agentLog("x")), "workflows", "wf_1", "agent-wf1.jsonl"), [assistant("msg_w", "claude-sonnet-5-5", { input_tokens: 1, output_tokens: 1 })]);
    await synced();
    const roles = usageBy(db!, "role", ALL, 10).map((r) => r.key).sort();
    expect(roles).toEqual(["coder", "manager", "subagent"]);
    expect(all("SELECT project_cwd, title, main_agent FROM sessions")).toEqual([{ project_cwd: "/work/app", title: "Refactor auth", main_agent: "manager" }]);
  });

  test("defers a partial last line and reads only new bytes afterwards", async () => {
    const done = JSON.stringify(assistant("msg_1", "claude-sonnet-5-5", { input_tokens: 1, output_tokens: 1 }));
    const partial = JSON.stringify(assistant("msg_2", "claude-sonnet-5-5", { input_tokens: 1, output_tokens: 1 }));
    write(mainLog(), [], `${done}\n${partial.slice(0, 40)}`);
    expect((await synced()).newRequests).toBe(1);
    expect((await synced()).changed).toBe(0);
    appendFileSync(mainLog(), `${partial.slice(40)}\n`);
    expect((await synced()).newRequests).toBe(1);
    expect(all<{ n: number }>("SELECT COUNT(*) AS n FROM requests")[0]!.n).toBe(2);
  });

  test("re-reads a file that was truncated or replaced", async () => {
    write(mainLog(), [assistant("msg_1", "claude-sonnet-5-5", { input_tokens: 1, output_tokens: 1 }), prompt("hi")]);
    await synced();
    write(mainLog(), [assistant("msg_9", "claude-sonnet-5-5", { input_tokens: 1, output_tokens: 1 })]);
    expect((await synced()).newRequests).toBe(1);
  });

  test("prices legacy unsplit cache writes as 5m and flags unknown models", async () => {
    write(mainLog(), [
      assistant("msg_old", "claude-opus-5-5", { input_tokens: 0, cache_creation_input_tokens: 1e6, output_tokens: 0 }),
      assistant("msg_new", "claude-opus-5-5", {
        input_tokens: 0,
        cache_creation_input_tokens: 2e6,
        cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 },
        output_tokens: 0,
      }),
      assistant("msg_x", "claude-opus-9-9", { input_tokens: 5, output_tokens: 5 }),
    ]);
    const r = await synced();
    expect(r.unpriced).toEqual(["claude-opus-9-9"]);
    expect(all("SELECT message_id, cost_usd FROM requests ORDER BY message_id")).toEqual([
      { message_id: "msg_new", cost_usd: 13 },
      { message_id: "msg_old", cost_usd: 5 },
      { message_id: "msg_x", cost_usd: null },
    ]);
    expect(usageTotal(db!, ALL)).toMatchObject({ requests: 3, cost_usd: 18, unpriced: 1 });
  });

  test("re-prices stored rows when Claude Code's cache or pricing.json changes", async () => {
    write(mainLog(), [assistant("msg_1", "claude-opus-9-9", { input_tokens: 1e6, output_tokens: 0 })]);
    await synced();
    const rates = { inputTokens: 7, outputTokens: 0, promptCacheWriteTokens: 0, promptCacheWrite1hTokens: 0, promptCacheReadTokens: 0 };
    writeFileSync(join(ctx.claude, ".claude.json"), JSON.stringify({ additionalModelCostsCache: { "claude-opus-9-9": rates } }));
    expect((await synced()).recomputed).toBe(1);
    expect(all("SELECT cost_usd FROM requests")).toEqual([{ cost_usd: 7 }]);
    writeFileSync(join(ctx.app, "pricing.json"), JSON.stringify({ "claude-opus-9-9": { ...rates, inputTokens: 1 } }));
    expect((await synced()).recomputed).toBe(1);
    expect(all("SELECT cost_usd FROM requests")).toEqual([{ cost_usd: 1 }]);
  });

  test("keeps the main transcript's latest cost-state total per session", async () => {
    write(mainLog(), [
      assistant("msg_1", "claude-opus-5-5", { input_tokens: 1e6, output_tokens: 0 }),
      entry({ type: "cost-state", totalCostUSD: 1.5 }),
      entry({ type: "cost-state", totalCostUSD: 4.1 }),
    ]);
    write(agentLog("abc"), [entry({ type: "cost-state", totalCostUSD: 99 })]);
    await synced();
    expect(all("SELECT cc_cost_usd FROM sessions")).toEqual([{ cc_cost_usd: 4.1 }]);
  });
});

describe("stats command", () => {
  test("parseSince accepts relative and absolute dates", () => {
    const now = Date.UTC(2026, 10, 27);
    expect(parseSince("2d", now)).toBe("2026-11-25T00:00:00.000Z");
    expect(parseSince("12h", now)).toBe("2026-11-26T12:00:00.000Z");
    expect(parseSince("2026-11-01")).toBe("2026-11-01T00:00:00.000Z");
    expect(() => parseSince("soon")).toThrow("invalid --since");
  });

  test("--json syncs and groups by project", async () => {
    write(mainLog(), [assistant("msg_1", "claude-opus-5-5", { input_tokens: 1e6, output_tokens: 0 })]);
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await run(["stats", "--by", "project", "--since", "2026-01-01", "--json"])).toBe(0);
      const out = JSON.parse(log.mock.calls[0]![0]);
      expect(out.rows).toEqual([expect.objectContaining({ key: "/work/app", requests: 1, cost_usd: 4 })]);
      expect(await run(["stats", "--since", "2026-01-01"])).toBe(0);
      expect(String(log.mock.calls[1]![0])).toContain("claude-opus-5-5");
    } finally {
      log.mockRestore();
    }
    await expect(run(["stats", "--by", "colour"])).rejects.toThrow("invalid --by");
  });
});
