import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Points HOME / Claude / app dirs at a fresh temp dir per test; never the real HOME. */
export function useTempHome() {
  const ctx = { home: "", claude: "", app: "" };
  const saved = { ...process.env };
  beforeEach(() => {
    ctx.home = mkdtempSync(join(tmpdir(), "cm-home-"));
    ctx.claude = join(ctx.home, ".claude");
    ctx.app = join(ctx.home, ".claude-manager");
    process.env.HOME = ctx.home;
    process.env.CLAUDE_CONFIG_DIR = ctx.claude;
    process.env.CLAUDE_MANAGER_HOME = ctx.app;
    // Source-run tests apply policies; product code allows a source hook only with this opt-in.
    process.env.CLAUDE_MANAGER_DEV_POLICY = "1";
  });
  afterEach(() => {
    rmSync(ctx.home, { recursive: true, force: true });
    for (const k of ["HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_MANAGER_HOME", "CLAUDE_MANAGER_DEV_POLICY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  return ctx;
}
