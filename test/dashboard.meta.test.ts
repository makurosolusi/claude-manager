import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { loadConfigSync, configPath } from "../src/config/config.store.ts";
import { liveMeta } from "../src/server/dashboard.meta.ts";
import type { SyncMeta } from "../src/server/dashboard.types.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const state: SyncMeta = { synced_at: null, changed_at: null, error: null, interval_ms: 1 };
const save = (data: unknown) => {
  Bun.spawnSync(["mkdir", "-p", ctx.app]);
  writeFileSync(configPath(), typeof data === "string" ? data : JSON.stringify(data));
};

describe("liveMeta", () => {
  test("meta.roles reflects a config change without a restart", () => {
    const meta = liveMeta(state);
    expect(meta().roles.some((r) => r.name === "qa-extra")).toBe(false);
    save({ customRoles: { "qa-extra": { tier: "basic", description: "x" } }, tiers: { think: "claude-opus-x" } });
    const next = meta();
    expect(next.roles.find((r) => r.name === "qa-extra")).toEqual({ name: "qa-extra", tier: "basic", source: "custom" });
    expect(next.tiers.think).toBe("claude-opus-x");
  });

  test("a malformed config keeps the last good roles", () => {
    save({ customRoles: { "qa-extra": { tier: "basic", description: "x" } } });
    const meta = liveMeta(state);
    save("{ not json");
    expect(meta().roles.some((r) => r.name === "qa-extra")).toBe(true);
    expect(() => loadConfigSync()).toThrow("invalid JSON");
  });

  test("sync state is spread live", () => {
    const s = { ...state };
    const meta = liveMeta(s);
    s.error = "boom";
    expect(meta().error).toBe("boom");
  });
});
