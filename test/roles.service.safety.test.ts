import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { CliError } from "../src/cli.error.ts";
import { loadConfig } from "../src/config/config.store.ts";
import { allRoles } from "../src/roles/roles.registry.ts";
import { addRole, disableRole, removeRole, updateRole } from "../src/roles/roles.service.ts";
import type { AgentInput, AgentPatch } from "../src/server/agents.types.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const EMPTY = { version: 1 as const, installs: {} };
const PROTO_NAMES = ["__proto__", "constructor", "toString", "hasOwnProperty"];
const valid = { name: "ui-ux", description: "Designs UI", model: { tier: "work" }, tools: ["Read"] };
const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};
const reason = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    return { message: (err as CliError).message, reason: (err as CliError).reason };
  }
  throw new Error("expected a CliError");
};
const polluted = () => ["prompt", "description", "tools", "tier"].filter((k) => k in {});

afterEach(() => {
  for (const k of ["prompt", "description", "tools", "tier"]) delete (Object.prototype as Record<string, unknown>)[k];
});

describe("prototype keys", () => {
  test.each(PROTO_NAMES)("addRole %s is 400", async (name) => {
    expect((await reason(async () => addRole(await loadConfig(), { ...valid, name } as AgentInput))).reason).toBe("invalid");
  });

  test.each(PROTO_NAMES)("updateRole/removeRole/disableRole %s are 404 and Object.prototype stays clean", async (name) => {
    const config = await loadConfig();
    expect((await reason(() => updateRole(config, name, { prompt: "x" }))).reason).toBe("not_found");
    expect((await reason(() => updateRole(config, name, { description: "x", model: { tier: "work" } }))).reason).toBe("not_found");
    expect((await reason(() => removeRole(config, name, EMPTY))).reason).toBe("not_found");
    expect((await reason(() => disableRole(config, name, EMPTY))).reason).toBe("not_found");
    expect(polluted()).toEqual([]);
  });

  test("CLI roles edit / rm on __proto__ and constructor fail and leave Object.prototype clean", async () => {
    await quiet(["install"]);
    const promptFile = join(ctx.home, "p.txt");
    writeFileSync(promptFile, "x");
    for (const name of ["__proto__", "constructor"]) {
      expect((await reason(() => quiet(["roles", "edit", name, "--prompt-file", promptFile]))).reason).toBe("not_found");
      expect((await reason(() => quiet(["roles", "rm", name]))).reason).toBe("not_found");
    }
    expect(polluted()).toEqual([]);
  });

  test("a roleModels entry is only read from own keys", async () => {
    const config = await loadConfig();
    config.customRoles = JSON.parse('{"constructor":{"tier":"work","description":"d"}}');
    const role = allRoles(config).find((r) => r.name === "constructor")!;
    expect(role.model).toBeUndefined();
    expect(role.tier).toBe("work");
  });
});

describe("input types are 400 naming the field, never a 500", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["missing name", { name: undefined }, "name is required"],
    ["numeric name", { name: 5 }, "name is required"],
    ["numeric description", { description: 5 }, "description must be a string"],
    ["string tools", { tools: "Read" }, "tools must be null or an array of strings"],
    ["numeric tool", { tools: [1] }, "tools must be null or an array of strings"],
    ["numeric prompt", { prompt: 5 }, "prompt must be a string"],
    ["string model", { model: "work" }, "model must be one of {tier}, {pin} or {default}"],
  ];
  test.each(cases)("addRole: %s", async (_label, over, message) => {
    expect(await reason(async () => addRole(await loadConfig(), { ...valid, ...over } as unknown as AgentInput))).toEqual({ message, reason: "invalid" });
  });

  test("updateRole: wrong types on a custom role", async () => {
    const config = addRole(await loadConfig(), valid as AgentInput);
    const bad = (patch: Record<string, unknown>) => reason(() => updateRole(config, "ui-ux", patch as AgentPatch));
    expect((await bad({ description: 5 })).message).toBe("description must be a string");
    expect((await bad({ tools: { a: 1 } })).message).toBe("tools must be null or an array of strings");
    expect((await bad({ prompt: [] })).message).toBe("prompt must be a string");
  });
});
