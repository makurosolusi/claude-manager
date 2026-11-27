import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { buildBinary } from "../scripts/build.ts";

let dir: string;
let bin: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cm-bin-"));
  bin = join(dir, "claude-manager");
  await buildBinary(bin); // same path as `bun run build`, so the Tailwind plugin is included
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("compiled binary prints version and help", () => {
  expect(Bun.spawnSync([bin, "-v"]).stdout.toString().trim()).toBe(pkg.version);
  expect(Bun.spawnSync([bin, "--help"]).stdout.toString()).toContain("Usage:");
});
