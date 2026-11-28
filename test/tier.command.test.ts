import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tierCommand } from "../src/commands/tier.command.ts";
import { TIER_NEW_SESSIONS_NOTE } from "../src/roles/model.ids.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const backups = () => (existsSync(join(ctx.app, "backups")) ? readdirSync(join(ctx.app, "backups")) : []);

async function run(...args: string[]): Promise<string[]> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await tierCommand.run(args);
    return log.mock.calls.map((c) => String(c[0]));
  } finally {
    log.mockRestore();
  }
}

describe("tier set", () => {
  test("prints the result and the shared sessions note", async () => {
    const out = await run("set", "think", "claude-opus-9");
    expect(out[0]).toBe("think (opus) -> claude-opus-9; re-applied 0 install(s)");
    expect(out[1]).toBe(TIER_NEW_SESSIONS_NOTE);
  });
  test("a no-op set writes no backup", async () => {
    await run("set", "think", "claude-opus-9");
    const before = backups().length;
    const out = await run("set", "think", "claude-opus-9");
    expect(out).toHaveLength(2);
    expect(backups()).toHaveLength(before);
    await run("set", "think", "claude-opus-10");
    expect(backups()).toHaveLength(before + 1);
  });
});
