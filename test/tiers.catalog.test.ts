import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "../src/db/db.schema.ts";
import { DEFAULT_TIER_MODELS } from "../src/config/config.store.ts";
import type { Config } from "../src/config/config.store.ts";
import type { Pricing, Rates } from "../src/ingest/pricing.service.ts";
import { buildTiers, TIER_DAYS } from "../src/tiers/tiers.catalog.ts";
import { useTempHome } from "./test.home.ts";

// test-only fixtures: synthetic rows, never real logs.
useTempHome();
const NOW = new Date("2026-11-28T00:00:00.000Z");
const rate = (input: number, output: number, extra: Partial<Rates> = {}): Rates => ({
  inputTokens: input, outputTokens: output, promptCacheWriteTokens: 0, promptCacheWrite1hTokens: 0, promptCacheReadTokens: 0, webSearchRequests: 0, ...extra,
});
const PRICING: Pricing = { version: "t", table: { "claude-opus-5-5": rate(4, 20), "claude-sonnet-5-5": rate(2, 10), "claude-old": rate(1, 5), "claude-haiku-5-5": rate(0.1, 0.5) } };
const CONFIG = { tiers: { ...DEFAULT_TIER_MODELS }, roleModels: {}, customRoles: {}, disabledRoles: [] } as unknown as Config;

let db: Database;
let n = 0;
beforeEach(() => {
  db = openDb();
  db.run("INSERT INTO sessions (id) VALUES ('s1')");
});
afterEach(() => db.close());

function req(model: string, o: { ts?: string; input?: number; output?: number; cost?: number | null } = {}) {
  db.run(
    `INSERT INTO requests (message_id, session_id, ts, model, input, cache_5m, cache_1h, cache_read, output, thinking, web_search, cost_usd, pricing_version, is_sidechain)
     VALUES (?, 's1', ?, ?, ?, 0, 0, 0, ?, 0, 0, ?, 'v', 0)`,
    [`m${n++}`, o.ts ?? "2026-11-20T00:00:00.000Z", model, o.input ?? 1_000_000, o.output ?? 100_000, o.cost === undefined ? 6 : o.cost],
  );
}

describe("buildTiers", () => {
  test("models are the deduped union of pricing, usage and config; synthetic dropped", () => {
    req("claude-opus-5-5-20261101[1m]");
    req("<synthetic>");
    req("claude-seen-only");
    const cfg = { ...CONFIG, tiers: { ...CONFIG.tiers, basic: "my-pinned:model" } } as Config;
    const ids = buildTiers(cfg, db, PRICING, NOW).models.map((m) => m.id);
    expect(ids).toEqual([...new Set(ids)].sort());
    expect(ids).toEqual(expect.arrayContaining(["claude-opus-5-5", "claude-old", "claude-seen-only", "my-pinned:model", "claude-sonnet-5-5"]));
    expect(ids).not.toContain("<synthetic>");
    const byId = Object.fromEntries(buildTiers(cfg, db, PRICING, NOW).models.map((m) => [m.id, m]));
    expect(byId["claude-opus-5-5"]).toMatchObject({ input_usd: 4, output_usd: 20, in_pricing: true, requests_30d: 1 });
    expect(byId["claude-seen-only"]).toMatchObject({ input_usd: null, in_pricing: false, requests_30d: 1 });
  });

  test("counts cover only the served model and the 30-day window", () => {
    req("claude-opus-5-5");
    req("claude-opus-5-5-20261101[1m]", { cost: null });
    req("claude-sonnet-5-5");
    req("claude-opus-5-5", { ts: "2026-10-01T00:00:00.000Z" });
    const res = buildTiers(CONFIG, db, PRICING, NOW);
    expect(res.days).toBe(TIER_DAYS);
    const think = res.tiers.find((t) => t.tier === "think")!;
    expect(think).toMatchObject({ alias: "opus", env: "ANTHROPIC_DEFAULT_OPUS_MODEL", requests_30d: 2, cost_30d: 6, unpriced_30d: 1 });
    expect(res.tiers.find((t) => t.tier === "work")!.requests_30d).toBe(1);
    expect(res.tiers.find((t) => t.tier === "basic")!.requests_30d).toBe(0);
  });

  test("estimate for the current model matches cost_30d; other models re-price the same tokens", () => {
    req("claude-opus-5-5", { cost: 6 });
    req("claude-opus-5-5", { cost: 6 });
    const think = buildTiers(CONFIG, db, PRICING, NOW).tiers.find((t) => t.tier === "think")!;
    // 2 requests x (1M in x $4 + 0.1M out x $20) = $12
    expect(think.estimate_30d["claude-opus-5-5"]).toBeCloseTo(12, 9);
    expect(think.cost_30d).toBe(12);
    expect(think.estimate_30d["claude-old"]).toBeCloseTo(2 * (1 + 0.5), 9);
    expect(think.estimate_30d["claude-sonnet-5-5"]).toBeCloseTo(2 * (2 + 1), 9);
  });

  test("an option without rates estimates null; long-prompt rates apply per option threshold", () => {
    const pricing: Pricing = { version: "t", table: { ...PRICING.table, "claude-long": rate(1, 1, { longPrompt: { abovePromptTokens: 500_000, inputTokens: 3, outputTokens: 1 } as Rates["longPrompt"] }) } };
    req("claude-opus-5-5");
    req("claude-ghost-model");
    const think = buildTiers(CONFIG, db, pricing, NOW).tiers.find((t) => t.tier === "think")!;
    expect(think.estimate_30d["claude-ghost-model"]).toBeNull();
    // 1M prompt tokens > 500k threshold: input at 3, output at 1 -> 3 + 0.1
    expect(think.estimate_30d["claude-long"]).toBeCloseTo(3.1, 9);
  });

  test("etag is none without a config file", () => {
    expect(buildTiers(CONFIG, db, PRICING, NOW).etag).toBe("none");
  });
});
