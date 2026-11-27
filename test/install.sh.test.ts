import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetName } from "../src/update/update.service.ts";

const REPO = "test-owner/claude-manager"; // test-only
const BIN = "#!/bin/sh\necho installed\n"; // test-only
const asset = assetName(); // the script picks the host's asset via uname
const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

let files: Record<string, string> = {};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const body = files[new URL(req.url).pathname];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  },
});
afterAll(() => server.stop(true));

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "cm-install-sh-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function serve(prefix: string, sums: string) {
  files = { [`/${REPO}/releases/${prefix}/${asset}`]: BIN, [`/${REPO}/releases/${prefix}/SHA256SUMS`]: sums };
}

async function install(env: Record<string, string> = {}) {
  const proc = Bun.spawn(["sh", "install.sh"], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: dir,
      CLAUDE_MANAGER_REPO: REPO,
      CLAUDE_MANAGER_RELEASE_DOWNLOAD: `http://127.0.0.1:${server.port}`,
      CLAUDE_MANAGER_INSTALL_DIR: join(dir, "bin"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err, bin: join(dir, "bin", "claude-manager") };
}

test("installs latest verified binary with mode 755 and warns about PATH", async () => {
  serve("latest/download", `${sha(BIN)}  ${asset}\n`);
  const r = await install();
  expect(r.code).toBe(0);
  expect(readFileSync(r.bin, "utf8")).toBe(BIN);
  expect(statSync(r.bin).mode & 0o777).toBe(0o755);
  expect(r.err).toContain("is not in PATH");
});

test("pinned version uses /download/vX", async () => {
  serve("download/v1.2.3", `${sha(BIN)} *${asset}\n`);
  const r = await install({ CLAUDE_MANAGER_VERSION: "1.2.3" });
  expect(r.code).toBe(0);
  expect(existsSync(r.bin)).toBe(true);
});

test("checksum mismatch fails and installs nothing", async () => {
  serve("latest/download", `${sha("tampered")}  ${asset}\n`);
  const r = await install();
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("checksum mismatch");
  expect(existsSync(r.bin)).toBe(false);
});

test("missing release fails with the URL", async () => {
  files = {};
  const r = await install();
  expect(r.code).not.toBe(0);
  expect(r.err).toContain(`/${REPO}/releases/latest/download/${asset}`);
});
