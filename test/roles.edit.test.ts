import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { loadConfig } from "../src/config/config.store.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const out: string[] = [];
async function cli(...argv: string[]) {
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
}
const addUiUx = () => cli("roles", "add", "ui-ux", "--tier", "work", "--description", "UI", "--tools", "Read");
const file = (name: string, text: string) => {
  mkdirSync(ctx.home, { recursive: true });
  const p = join(ctx.home, name);
  writeFileSync(p, text);
  return p;
};

describe("roles edit flags", () => {
  test("--tier, --pin and --default on a preset", async () => {
    await cli("install");
    await cli("roles", "edit", "coder", "--tier", "basic");
    expect((await loadConfig()).roleModels.coder).toBe("basic");
    await cli("roles", "edit", "coder", "--pin", "fable");
    expect((await loadConfig()).roleModels.coder).toBe("fable");
    await cli("roles", "edit", "coder", "--default");
    expect((await loadConfig()).roleModels.coder).toBeUndefined();
    expect(out.at(-1)).toMatch(/^updated coder; re-applied \d+ install\(s\)$/);
  });

  test("--disable then --enable a preset", async () => {
    await cli("install");
    await cli("roles", "edit", "writer", "--disable");
    expect((await loadConfig()).disabledRoles).toContain("writer");
    await cli("roles", "edit", "writer", "--enable");
    expect((await loadConfig()).disabledRoles).not.toContain("writer");
  });

  test("custom: --description, --tools list, --tools all, --prompt-file", async () => {
    await cli("install");
    await addUiUx();
    await cli("roles", "edit", "ui-ux", "--description", "New text", "--tools", "Read, Grep", "--prompt-file", file("p.md", "Be nice"));
    let c = (await loadConfig()).customRoles["ui-ux"]!;
    expect([c.description, c.tools, c.prompt]).toEqual(["New text", ["Read", "Grep"], "Be nice"]);
    await cli("roles", "edit", "ui-ux", "--tools", "all", "--prompt-file", file("empty.md", ""));
    c = (await loadConfig()).customRoles["ui-ux"]!;
    expect(c.tools ?? null).toBeNull(); // null is stored as an absent key
    expect(c.prompt).toBeUndefined();
  });

  test("custom --tier replaces the tier", async () => {
    await cli("install");
    await addUiUx();
    await cli("roles", "edit", "ui-ux", "--tier", "basic");
    expect((await loadConfig()).customRoles["ui-ux"]!.tier).toBe("basic");
  });
});

describe("roles edit errors", () => {
  test("exclusive flags are usage errors", async () => {
    await cli("install");
    for (const flags of [["--tier", "work", "--pin", "x"], ["--tier", "work", "--default"], ["--pin", "x", "--default"], ["--enable", "--disable"]]) {
      await expect(cli("roles", "edit", "coder", ...flags)).rejects.toThrow("mutually exclusive");
    }
  });

  test("no flags prints usage and fails", async () => {
    await cli("install");
    await expect(cli("roles", "edit", "coder")).rejects.toThrow("usage: claude-manager roles edit");
  });

  test("service messages pass through", async () => {
    await cli("install");
    await expect(cli("roles", "edit", "coder", "--description", "x")).rejects.toThrow("preset agents only allow model and enabled");
    await addUiUx();
    await expect(cli("roles", "edit", "ui-ux", "--enable")).rejects.toThrow("custom agents have no enabled state; delete it instead");
    await expect(cli("roles", "edit", "coder", "--tier", "huge")).rejects.toThrow();
  });

  test("missing prompt file names the path", async () => {
    await cli("install");
    await addUiUx();
    const missing = join(ctx.home, "nope.md");
    await expect(cli("roles", "edit", "ui-ux", "--prompt-file", missing)).rejects.toThrow(missing);
  });
});
