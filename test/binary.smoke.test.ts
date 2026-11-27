import type { Subprocess } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { buildBinary } from "../scripts/build.ts";
import type { Overview } from "../src/server/dashboard.types.ts";

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

// test-only: synthetic transcript shaped like Claude Code's JSONL (see test/dashboard.test.ts), never real logs.
function writeTranscript(claudeDir: string) {
  const sid = "dddddddd-0000-0000-0000-000000000004";
  const cwd = "/work/smoke";
  const ts = Date.now() - 60_000;
  const base = { sessionId: sid, cwd, gitBranch: "main", version: "2.5.0" };
  const entries = [
    { ...base, uuid: "u-1", timestamp: new Date(ts).toISOString(), type: "user", promptSource: "typed", message: { role: "user", content: "hi" } },
    {
      ...base,
      uuid: "u-2",
      timestamp: new Date(ts + 1000).toISOString(),
      type: "assistant",
      requestId: "req-s1",
      message: { id: "s1", model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 100 }, content: [], stop_reason: "end_turn" },
    },
  ];
  const dir = join(claudeDir, "projects", cwd.replaceAll("/", "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.jsonl`), entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

function freePort(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const { port } = s;
  s.stop(true);
  if (!port) throw new Error("port 0 did not yield a bound port");
  return port;
}

/** Reads stdout until `needle` appears; fails after `ms` instead of sleeping a fixed time. */
async function waitFor(stream: ReadableStream<Uint8Array>, needle: string, ms: number): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  const deadline = Date.now() + ms;
  try {
    while (!out.includes(needle)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out after ${ms}ms waiting for "${needle}"; stdout: ${out}`);
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out waiting for "${needle}"; stdout: ${out}`)), left));
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) throw new Error(`process exited before "${needle}"; stdout: ${out}`);
      out += decoder.decode(value, { stream: true });
    }
    return out;
  } finally {
    reader.releaseLock();
  }
}

describe("compiled dashboard", () => {
  let home: string;
  let env: Record<string, string>;
  let proc: Subprocess<"ignore", "pipe", "pipe"> | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cm-dash-home-"));
    const claude = join(home, ".claude");
    env = { ...(process.env as Record<string, string>), HOME: home, CLAUDE_CONFIG_DIR: claude, CLAUDE_MANAGER_HOME: join(home, ".claude-manager") };
    writeTranscript(claude);
  });

  afterEach(async () => {
    if (proc) {
      proc.kill("SIGINT");
      const code = await proc.exited;
      proc = undefined;
      expect(code).toBe(0); // clean shutdown on Ctrl+C
    }
    rmSync(home, { recursive: true, force: true });
  });

  test(
    "serves UI, bundled CSS, API with host guard, and refuses a busy port",
    async () => {
      const port = freePort();
      const url = `http://127.0.0.1:${port}`;
      proc = Bun.spawn([bin, "dashboard", "--port", String(port)], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      await waitFor(proc.stdout, `dashboard: http://127.0.0.1:${port}`, 10_000);

      const page = await fetch(`${url}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('<div id="root">');
      const css = html.match(/href="([^"]+\.css)"/)?.[1];
      expect(css).toBeDefined();
      expect(html).toMatch(/<script[^>]+src="[^"]+\.js"/);

      const sheet = await fetch(new URL(css as string, `${url}/`));
      expect(sheet.status).toBe(200);
      expect(await sheet.text()).toContain(".min-h-screen"); // used by src/web/app.tsx

      const res = await fetch(`${url}/api/overview?since=2000-01-01`);
      expect(res.status).toBe(200);
      const o = (await res.json()) as Overview;
      expect(o.total.requests).toBe(1);
      expect(o.total.cost_usd).toBeGreaterThan(0);

      const evil = await fetch(`${url}/api/overview`, { headers: { host: `evil.example:${port}` } });
      expect(evil.status).toBe(403);

      const second = Bun.spawnSync([bin, "dashboard", "--port", String(port)], { env, timeout: 10_000 });
      expect(second.exitCode).not.toBe(0);
      expect(second.stderr.toString()).toContain("in use");
    },
    15_000,
  );
});
