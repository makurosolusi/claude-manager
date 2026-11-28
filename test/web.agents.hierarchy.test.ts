import { describe, expect, test } from "bun:test";
import type { AgentRow } from "../src/server/agents.types.ts";
import { BUILTIN_AGENT_INFO } from "../src/roles/roles.builtins.ts";
import { affectedBy, buildHierarchy } from "../src/web/lib/agents.hierarchy.ts";

const row = (o: Partial<AgentRow> & { name: string }): AgentRow => ({
  kind: "preset", source: null, status: "enabled", description: null, color: null, tier: "work", pin: null, alias: "sonnet",
  model_id: "claude-sonnet-5-5", tools: null, disallowed_tools: null, scopes: [], main_agent: false,
  usage: { requests: 0, cost_usd: 0, unpriced: 0, last_ts: null, rerouted_pct: null }, ...o,
});
const ext = (name: string, alias: string | null) => row({ name, kind: "external", tier: null, alias, model_id: null });

describe("buildHierarchy", () => {
  test("main detection: none, one, two", () => {
    expect(buildHierarchy([row({ name: "coder" })]).mains).toHaveLength(0);
    expect(buildHierarchy([row({ name: "manager", main_agent: true })]).mains.map((a) => a.name)).toEqual(["manager"]);
    expect(buildHierarchy([row({ name: "a", main_agent: true }), row({ name: "b", main_agent: true })]).mains).toHaveLength(2);
  });
  test("main agent also appears in its tier", () => {
    const h = buildHierarchy([row({ name: "manager", tier: "think", main_agent: true })]);
    expect(h.tiers.think.map((a) => a.name)).toEqual(["manager"]);
  });
  test("pinned and disabled placement; externals are unmanaged", () => {
    const h = buildHierarchy([
      row({ name: "pinned", pin: "claude-opus-5-5" }),
      row({ name: "off", status: "disabled", tier: "basic" }),
      ext("Explore", "opus"),
    ]);
    expect(h.pinned.map((a) => a.name)).toEqual(["pinned"]);
    expect(h.tiers.work).toHaveLength(0);
    expect(h.tiers.basic.map((a) => a.name)).toEqual(["off"]);
    expect(h.unmanaged.map((a) => a.name)).toEqual(["Explore"]);
  });
});

describe("affectedBy", () => {
  test("basic includes background tasks and the /model session item", () => {
    const l = affectedBy("basic", []).map((i) => i.label);
    expect(l).toContain("Claude Code background tasks (haiku alias)");
    expect(l).toContain("Any session started with /model haiku or --model haiku");
    expect(l).toContain("web-fetch");
  });
  test("work includes statusline-setup, enabled routed agents and externals; excludes pinned and disabled", () => {
    const l = affectedBy("work", [
      row({ name: "coder" }),
      row({ name: "pinned", pin: "claude-sonnet-5-6" }),
      row({ name: "off", status: "disabled" }),
      ext("custom-ext", "sonnet"),
    ]).map((i) => i.label);
    expect(l).toContain("statusline-setup");
    expect(l).toContain("coder");
    expect(l).toContain("custom-ext");
    expect(l).not.toContain("pinned");
    expect(l).not.toContain("off");
  });
  test("built-ins come from BUILTIN_AGENT_INFO by alias; inherit built-ins never appear", () => {
    for (const [tier, alias] of [["think", "opus"], ["work", "sonnet"], ["basic", "haiku"]] as const) {
      const want = Object.entries(BUILTIN_AGENT_INFO).filter(([, i]) => i.model === alias).map(([n]) => n);
      const got = affectedBy(tier, []).filter((i) => i.kind === "builtin").map((i) => i.label);
      expect(got).toEqual(want);
    }
    expect(affectedBy("think", []).map((i) => i.label)).toContain("Explore");
    expect(affectedBy("work", []).map((i) => i.label)).not.toContain("general-purpose");
  });
  test("an external named like a built-in is not listed twice", () => {
    const l = affectedBy("think", [ext("Explore", "opus")]).filter((i) => i.label === "Explore");
    expect(l).toHaveLength(1);
  });
});
