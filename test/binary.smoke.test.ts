import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

let dir: string;
let bin: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cm-bin-"));
  bin = join(dir, "claude-manager");
  const build = Bun.spawnSync([
    "bun", "build", "src/cli.ts", "--compile",
    "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
    "--outfile", bin,
  ]);
  expect(build.exitCode).toBe(0);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("compiled binary prints version and help", () => {
  expect(Bun.spawnSync([bin, "-v"]).stdout.toString().trim()).toBe(pkg.version);
  expect(Bun.spawnSync([bin, "--help"]).stdout.toString()).toContain("Usage:");
});
