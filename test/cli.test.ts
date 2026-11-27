import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

export function runCli(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], {
    env: { ...process.env, ...env },
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

describe("cli dispatch", () => {
  test("-v and --version print version", () => {
    expect(runCli(["-v"]).out.trim()).toBe(pkg.version);
    expect(runCli(["--version"]).out.trim()).toBe(pkg.version);
  });

  test("no args and --help print usage", () => {
    for (const args of [[], ["--help"], ["-h"], ["help"]]) {
      const r = runCli(args);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Usage: claude-manager <command>");
    }
  });

  test("unknown command exits 1 with clean message", () => {
    const r = runCli(["nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('error: unknown command "nope"');
    expect(r.err).not.toContain("at ");
  });
});
