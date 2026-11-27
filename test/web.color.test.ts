import { expect, test } from "bun:test";
import { Wrench, Plug, Bot, FileText } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { RoleBadge } from "../src/web/components/role.badge.tsx";
import { ShareBar } from "../src/web/components/share.bar.tsx";
import { EXT_CLASSES, FAMILY_CLASSES, PRESET_SLOTS, fnv1a32, roleColor, type RoleMeta } from "../src/web/lib/color.tokens.ts";
import { FAMILY_ICON, KPI_ICON, UI_ICON, toolIcon } from "../src/web/lib/icon.map.ts";
import { FAMILY_COLOR, FAMILY_LABEL, modelFamily, tierFamily, tierOf } from "../src/web/lib/model.tier.ts";
import { cacheLevel, sessionStatus, stopTone } from "../src/web/lib/status.level.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

test("fnv1a32 matches published vectors and is stable", () => {
  expect(fnv1a32("")).toBe(0x811c9dc5);
  expect(fnv1a32("a")).toBe(0xe40c292c);
  expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  expect(fnv1a32("reviewer-x")).toBe(fnv1a32("reviewer-x"));
});

test("roleColor: neutral, presets, hashed non-preset", () => {
  expect(roleColor("main")).toEqual({ slot: null, ext: null, custom: false });
  expect(roleColor("subagent")).toEqual({ slot: null, ext: null, custom: false });
  expect(roleColor("coder")).toEqual({ slot: 3, ext: null, custom: false });
  expect(Object.keys(PRESET_SLOTS)).toHaveLength(6);
  const c = roleColor("Explore");
  expect(c.custom).toBe(true);
  expect(c.slot).toBeNull();
  expect(c.ext).toBe((fnv1a32("Explore") % EXT_CLASSES.length) + 1);
  expect(roleColor("Explore")).toEqual(c);
  expect(roleColor("constructor").custom).toBe(true); // prototype keys are not presets
  const meta: RoleMeta[] = [{ name: "coder", tier: "work", source: "custom" }];
  expect(roleColor("coder", meta).custom).toBe(true);
  const names = ["general-purpose", "Explore", "fork", "claude", "web-fetch", "ui-ux", "qa-bot", "x1", "x2", "x3", "x4"];
  expect(new Set(names.map((n) => roleColor(n).ext)).size).toBeGreaterThan(1);
  for (const n of names) expect(roleColor(n).ext).toBeLessThanOrEqual(EXT_CLASSES.length);
});

const badge = (role: string, roles?: RoleMeta[]) => renderToStaticMarkup(createElement(RoleBadge, { role, roles }));
test("RoleBadge variant per kind: preset tinted, custom/external outline with their own icon", () => {
  const roles: RoleMeta[] = [{ name: "ui-ux", tier: "work", source: "custom" }, { name: "coder", tier: "work", source: "preset" }];
  const preset = badge("coder", roles);
  expect(preset).toContain("bg-role-3-bg");
  expect(preset).toContain("lucide-code");
  const custom = badge("ui-ux", roles);
  expect(custom).toMatch(/border-ext-\d text-ext-\d-fg/);
  expect(custom).not.toContain("-bg ");
  expect(custom).not.toContain("border-dashed");
  expect(custom).toContain("lucide-user-round");
  const external = badge("general-purpose", roles);
  expect(external).toMatch(/border-ext-\d/);
  expect(external).toContain("lucide-bot");
  expect(external).not.toContain("lucide-user-round");
  expect(badge("main", roles)).toContain("tone-neutral");
});

// Hue separation: parse the light-theme tokens and compare OKLCH hues.
const css = readFileSync(new URL("../src/web/index.css", import.meta.url), "utf8");
const token = (name: string, from = css.indexOf(":root {")) => /#[0-9a-f]{6}/.exec(css.slice(css.indexOf(`--${name}:`, from)))![0];
function oklch(hex: string): { c: number; h: number } {
  const lin = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}
test("non-preset palette hues stay clear of preset roles, families and tones", () => {
  const others = [
    ...[1, 2, 3, 4, 5, 6].map((n) => `role-${n}`), ...["opus", "sonnet", "haiku", "fable"].map((f) => `model-${f}`),
    ...["success", "warning", "danger", "info"].map((k) => `tone-${k}`),
  ].map((n) => oklch(token(n)));
  for (let n = 1; n <= EXT_CLASSES.length; n++) {
    const mine = oklch(token(`ext-${n}`));
    expect(mine.c).toBeGreaterThan(0.1); // chromatic, not gray
    for (const o of others) {
      const d = Math.abs(mine.h - o.h);
      expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(15);
    }
  }
  expect(css).not.toContain("--ext-5:");
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
