import { expect, test } from "bun:test";
import { Wrench, Plug, Bot, FileText } from "lucide-react";
import { PRESET_SLOTS, fnv1a32, roleColor, type RoleMeta } from "../src/web/lib/color.tokens.ts";
import { toolIcon } from "../src/web/lib/icon.map.ts";
import { FAMILY_COLOR, tierFamily } from "../src/web/lib/model.tier.ts";
import { COST_HEAT_STEPS, cacheLevel, costHeat, sessionStatus, stopTone } from "../src/web/lib/status.level.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

test("fnv1a32 matches published vectors and is stable", () => {
  expect(fnv1a32("")).toBe(0x811c9dc5);
  expect(fnv1a32("a")).toBe(0xe40c292c);
  expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  expect(fnv1a32("reviewer-x")).toBe(fnv1a32("reviewer-x"));
});

test("roleColor: neutral, presets, hashed custom", () => {
  expect(roleColor("main")).toEqual({ slot: null, custom: false });
  expect(roleColor("subagent")).toEqual({ slot: null, custom: false });
  expect(roleColor("coder")).toEqual({ slot: 3, custom: false });
  expect(Object.keys(PRESET_SLOTS)).toHaveLength(6);
  const c = roleColor("Explore");
  expect(c.custom).toBe(true);
  expect(c.slot as number).toBe((fnv1a32("Explore") % 6) + 1);
  expect(roleColor("Explore")).toEqual(c);
  expect(roleColor("constructor").custom).toBe(true); // prototype keys are not presets
  const meta: RoleMeta[] = [{ name: "coder", tier: "work", source: "custom" }];
  expect(roleColor("coder", meta).custom).toBe(true);
});

test("costHeat buckets are absolute log steps per scale", () => {
  expect(costHeat(0, "request")).toBe(1);
  expect(costHeat(0.01, "request")).toBe(1);
  expect(costHeat(0.011, "request")).toBe(2);
  expect(costHeat(1, "request")).toBe(4);
  expect(costHeat(1.01, "request")).toBe(5);
  expect(costHeat(0.5, "session")).toBe(2);
  expect(costHeat(25, "session")).toBe(5);
  expect(costHeat(10, "aggregate")).toBe(2);
  expect(costHeat(500, "aggregate")).toBe(5);
  for (const bounds of Object.values(COST_HEAT_STEPS)) expect(bounds).toHaveLength(4);
});

test("sessionStatus thresholds 5 / 15 minutes", () => {
  expect(sessionStatus(ago(0), NOW)).toBe("live");
  expect(sessionStatus(ago(5), NOW)).toBe("live");
  expect(sessionStatus(ago(5.1), NOW)).toBe("idle");
  expect(sessionStatus(ago(15), NOW)).toBe("idle");
  expect(sessionStatus(ago(15.1), NOW)).toBe("ended");
  expect(sessionStatus(null, NOW)).toBe("ended");
  expect(sessionStatus("garbage", NOW)).toBe("ended");
});

test("cacheLevel and stopTone", () => {
  expect(cacheLevel(0.8)).toBe("success");
  expect(cacheLevel(0.79)).toBe("warning");
  expect(cacheLevel(0.5)).toBe("warning");
  expect(cacheLevel(0.49)).toBe("danger");
  expect(stopTone("refusal")).toBe("danger");
  expect(stopTone("tool_use")).toBe("info");
  expect(stopTone(null)).toBe("neutral");
  expect(stopTone("toString")).toBe("neutral");
});

test("toolIcon: known, mcp__ prefix, unknown", () => {
  expect(toolIcon("Read")).toBe(FileText);
  expect(toolIcon("Task")).toBe(Bot);
  expect(toolIcon("mcp__github__list")).toBe(Plug);
  expect(toolIcon("SomethingNew")).toBe(Wrench);
  expect(toolIcon("toString")).toBe(Wrench);
});

test("tier wears the colour of its configured model family", () => {
  expect(tierFamily("think")).toBe("opus");
  expect(tierFamily("think", { think: "claude-opus-4-7" })).toBe("opus");
  expect(tierFamily("think", { think: "claude-sonnet-4-5" })).toBe("sonnet"); // override
  expect(tierFamily("basic", { basic: "claude-haiku-4-5" })).toBe("haiku");
  expect(tierFamily("other", { think: "claude-opus-4-7" })).toBe("other");
  expect(FAMILY_COLOR.haiku).toBe("var(--model-haiku)");
});
