import { expect, test } from "bun:test";
import { BUILTIN_AGENT_INFO } from "../src/roles/roles.builtins.ts";
import { BUILTIN_AGENTS } from "../src/roles/roles.registry.ts";

test("builtin info keys match BUILTIN_AGENTS in order", () => {
  expect(Object.keys(BUILTIN_AGENT_INFO)).toEqual(BUILTIN_AGENTS);
});

test("every builtin has a non-empty description", () => {
  for (const [name, info] of Object.entries(BUILTIN_AGENT_INFO)) expect([name, info.description.trim().length > 0]).toEqual([name, true]);
});
