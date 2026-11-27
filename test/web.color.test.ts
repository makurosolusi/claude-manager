import { expect, test } from "bun:test";
import { Wrench, Plug, Bot, FileText } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareBar } from "../src/web/components/share.bar.tsx";
import { FAMILY_CLASSES, PRESET_SLOTS, fnv1a32, roleColor, type RoleMeta } from "../src/web/lib/color.tokens.ts";
import { FAMILY_ICON, KPI_ICON, UI_ICON, toolIcon } from "../src/web/lib/icon.map.ts";
import { FAMILY_COLOR, FAMILY_LABEL, modelFamily, tierFamily, tierOf } from "../src/web/lib/model.tier.ts";
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

test("fable is the 4th family with its own colour, icon and no default tier", () => {
  expect(modelFamily("fable-5-2")).toBe("fable");
  expect(modelFamily("claude-FABLE-5-2[1m]")).toBe("fable");
  expect(FAMILY_COLOR.fable).toBe("var(--model-fable)");
  expect(FAMILY_LABEL.fable).toBe("Fable");
  expect(FAMILY_CLASSES.fable.dot).toBe("bg-model-fable");
  expect(FAMILY_ICON.fable).not.toBe(FAMILY_ICON.other);
  expect(tierOf("fable-5-2")).toBe("other");
  expect(tierOf("fable-5-2", { think: "fable-5-2" })).toBe("think");
});

test("icon map: facet icons are distinct from family and KPI icons", () => {
  const reserved = [...Object.values(FAMILY_ICON), ...Object.values(KPI_ICON)];
  expect(reserved).not.toContain(UI_ICON.model);
  expect(reserved).not.toContain(UI_ICON.tier);
  expect(UI_ICON.model).not.toBe(UI_ICON.tier);
  for (const f of ["opus", "sonnet", "haiku", "fable", "other"] as const) expect(FAMILY_ICON[f]).toBeDefined();
});

test("ShareBar clamps and formats: 0, <0.1%, 100%, out of range", () => {
  const html = (share: number) => renderToStaticMarkup(createElement(ShareBar, { share }));
  expect(html(0)).toContain("width:0%");
  expect(html(0)).toContain(">0.0%<");
  expect(html(0.0004)).toContain("&lt;0.1%");
  expect(html(1)).toContain("width:100%");
  expect(html(1)).toContain(">100.0%<");
  expect(html(7)).toContain("width:100%");
  expect(html(-1)).toContain("width:0%");
  expect(html(Number.NaN)).toContain("width:0%");
  expect(html(0.5)).toContain("bg-foreground/15"); // visible track
});
