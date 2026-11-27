import { describe, expect, test } from "bun:test";
import type { RoleMeta } from "../src/web/lib/color.tokens.ts";
import { CUSTOM_ROLE_ICON, ROLE_ICON } from "../src/web/lib/icon.map.ts";
import { REROUTE_HINT, rerouteChipLabel, rerouteMarkNote } from "../src/web/lib/reroute.ts";
import { roleIcon } from "../src/web/lib/role.icon.ts";
import { sumRerouted } from "../src/web/lib/roles.aggregate.ts";

const roster: RoleMeta[] = [
  { name: "coder", tier: "work", source: "preset" },
  { name: "ui-ux", tier: "work", source: "custom" },
];

describe("rerouteMarkNote", () => {
  test("no marker when nothing was rerouted", () => {
    expect(rerouteMarkNote(0, 40)).toBeNull();
  });
  test("tooltip names the counts and carries the shared hint", () => {
    expect(rerouteMarkNote(3, 1200)).toBe(`3 of 1,200 requests rerouted. ${REROUTE_HINT}`);
    expect(REROUTE_HINT).toContain("claude-manager doctor");
  });
  test("chip label", () => expect(rerouteChipLabel(1500)).toBe("1,500 rerouted"));
});

describe("roleIcon", () => {
  test("preset keeps its own icon, custom gets UserRound, external gets Bot", () => {
    expect(roleIcon("coder", roster)).toBe(ROLE_ICON.coder!);
    expect(roleIcon("ui-ux", roster)).toBe(CUSTOM_ROLE_ICON);
    expect(roleIcon("Explore", roster)).toBe(ROLE_ICON.subagent!);
    expect(roleIcon("Explore")).toBe(ROLE_ICON.subagent!);
  });
  test("main and subagent keep their neutral icons", () => {
    expect(roleIcon("main", roster)).toBe(ROLE_ICON.main!);
    expect(roleIcon("subagent", roster)).toBe(ROLE_ICON.subagent!);
  });
});

test("sumRerouted adds up rows", () => {
  expect(sumRerouted([{ rerouted: 2 }, { rerouted: 0 }, { rerouted: 5 }])).toBe(7);
  expect(sumRerouted([])).toBe(0);
});
