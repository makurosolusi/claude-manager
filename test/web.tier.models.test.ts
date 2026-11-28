import { describe, expect, test } from "bun:test";
import { normalizeModelId as serverNormalize } from "../src/tiers/tiers.catalog.ts";
import { fmtPrice, normalizeModelId, groupByFamily, isAliasValue, modelVersion, newerInFamily, validateModelId } from "../src/web/lib/tier.models.ts";

const ids = (...a: string[]) => a.map((id) => ({ id }));

describe("tier.models", () => {
  test("modelVersion parses family, major, minor", () => {
    expect(modelVersion("claude-sonnet-5-5")).toEqual({ family: "sonnet", major: 5, minor: 5 });
    expect(modelVersion("claude-opus-5")).toEqual({ family: "opus", major: 5, minor: 0 });
    expect(modelVersion("gpt-4")).toBeNull();
  });
  test("dated and [1m] ids are normalized", () => {
    expect(modelVersion("claude-haiku-4-5-20251001")).toEqual({ family: "haiku", major: 4, minor: 5 });
    expect(modelVersion("claude-sonnet-4-5[1m]")?.minor).toBe(5);
  });
  test("newerInFamily: 5-6 beats 5-5, highest wins", () => {
    expect(newerInFamily("claude-sonnet-5-5", ids("claude-sonnet-5-6", "claude-sonnet-5-7", "claude-sonnet-5-5"))).toBe("claude-sonnet-5-7");
    expect(newerInFamily("claude-sonnet-5-5", ids("claude-sonnet-5-5"))).toBeNull();
  });
  test("nothing is newer across families", () => {
    expect(newerInFamily("claude-sonnet-5-5", ids("claude-opus-9-9", "claude-haiku-9-9"))).toBeNull();
  });
  test("alias rejection and pin validation", () => {
    expect(isAliasValue("opusplan")).toBe(true);
    expect(validateModelId("sonnet")).toBe('model must be a full model ID, not the alias "sonnet"');
    expect(validateModelId("bad id!")).toBe('invalid model id "bad id!"');
    expect(validateModelId("x".repeat(129))).toContain("invalid model id");
    expect(validateModelId("claude-sonnet-5-6")).toBeNull();
  });
  test("groupByFamily orders families and sorts versions descending", () => {
    const g = groupByFamily(ids("zzz", "claude-haiku-5-5", "claude-sonnet-4-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-1"));
    expect(g.map((x) => x.family)).toEqual(["opus", "sonnet", "haiku", "fable", "other"]);
    expect(g[1]!.items.map((i) => i.id)).toEqual(["claude-sonnet-5-5", "claude-sonnet-4-5"]);
  });
  test("fmtPrice", () => {
    expect(fmtPrice(4, 20)).toBe("$4 in · $20 out / MTok");
    expect(fmtPrice(null, 20)).toBe("No price known");
  });
  test("normalizeModelId agrees with the server on sample ids", () => {
    for (const id of ["claude-sonnet-5-5", "Claude-Opus-5-5[1m]", "claude-haiku-4-5-20251001", " claude-sonnet-4-5-20250929[1m] ", "fable", "gpt-4"]) {
      expect(normalizeModelId(id)).toBe(serverNormalize(id));
    }
    expect(normalizeModelId("Claude-Haiku-4-5-20251001[1m]")).toBe("claude-haiku-4-5");
  });
});
