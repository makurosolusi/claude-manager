import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { assetName, compareVersions, fetchLatestTag, installRelease, isCompiledBinary, type ReleaseSource } from "../src/update/update.service.ts";

const REPO = "test-owner/claude-manager"; // test-only
const NEW_TAG = "v99.0.0"; // test-only
const ASSET = "claude-manager-linux-x64";
const NEW_BIN = "#!/bin/sh\necho new\n"; // test-only

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

// Fake GitHub: routes are swapped per test via `files`.
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
const base = `http://127.0.0.1:${server.port}`;
const src: ReleaseSource = { repo: REPO, api: base, download: base };
const latestPath = `/repos/${REPO}/releases/latest`;
const dl = (name: string) => `/${REPO}/releases/download/${NEW_TAG}/${name}`;

function publish(tag: string, sums = `${sha(NEW_BIN)}  ${ASSET}\n`) {
  files = { [latestPath]: JSON.stringify({ tag_name: tag }), [dl(ASSET)]: NEW_BIN, [dl("SHA256SUMS")]: sums };
}

describe("compareVersions", () => {
  test("orders by patch, minor, major", () => {
    expect(compareVersions("0.1.1", "0.1.0")).toBe(1);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1); // numeric, not lexical
  });
  test("equal and v prefix", () => {
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("v1.2.3", "v1.2.4")).toBe(-1);
  });
  test("rejects non-semver", () => {
    expect(() => compareVersions("1.2", "1.2.0")).toThrow("invalid version");
  });
});

describe("assetName / isCompiledBinary", () => {
  test("maps platform and arch", () => {
    expect(assetName("darwin", "arm64")).toBe("claude-manager-darwin-arm64");
    expect(assetName("darwin", "x64")).toBe("claude-manager-darwin-x64");
    expect(assetName("linux", "x64")).toBe("claude-manager-linux-x64");
    expect(assetName("linux", "arm64")).toBe("claude-manager-linux-arm64");
  });
  test("unsupported platform/arch throws", () => {
    expect(() => assetName("win32", "x64")).toThrow("no release binary for win32-x64");
    expect(() => assetName("linux", "ia32")).toThrow("no release binary for linux-ia32");
  });
  test("bun runtime is not a compiled binary", () => {
    expect(isCompiledBinary("/usr/local/bin/bun")).toBe(false);
    expect(isCompiledBinary("/opt/bun/BUN.EXE")).toBe(false);
    expect(isCompiledBinary("/home/u/.local/bin/claude-manager")).toBe(true);
  });
});

describe("release download", () => {
  let dir: string;
  let target: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cm-update-"));
    target = join(dir, "claude-manager");
    writeFileSync(target, "old", { mode: 0o755 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("fetchLatestTag reads tag_name", async () => {
    publish(NEW_TAG);
    expect(await fetchLatestTag(src)).toBe(NEW_TAG);
  });

  test("404 names the URL and status", async () => {
    files = {};
    const p = fetchLatestTag(src);
    await expect(p).rejects.toThrow(`GET ${base}${latestPath} failed: HTTP 404`);
  });

  test("installs verified binary atomically with mode 755", async () => {
    publish(NEW_TAG);
    await installRelease(NEW_TAG, target, ASSET, src);
    expect(readFileSync(target, "utf8")).toBe(NEW_BIN);
    expect(statSync(target).mode & 0o777).toBe(0o755);
  });

  test("sha mismatch throws and leaves target untouched", async () => {
    publish(NEW_TAG, `${sha("something else")}  ${ASSET}\n`);
    await expect(installRelease(NEW_TAG, target, ASSET, src)).rejects.toThrow("checksum mismatch");
    expect(readFileSync(target, "utf8")).toBe("old");
  });

  test("asset missing from SHA256SUMS or server throws, target untouched", async () => {
    publish(NEW_TAG, `${sha(NEW_BIN)}  claude-manager-darwin-arm64\n`);
    await expect(installRelease(NEW_TAG, target, ASSET, src)).rejects.toThrow(`${ASSET} is not listed`);
    publish(NEW_TAG);
    delete files[dl(ASSET)];
    await expect(installRelease(NEW_TAG, target, ASSET, src)).rejects.toThrow(`${base}${dl(ASSET)} failed: HTTP 404`);
    expect(readFileSync(target, "utf8")).toBe("old");
  });
});

describe("update command (via env overrides)", () => {
  let home: string;
  beforeEach(() => (home = mkdtempSync(join(tmpdir(), "cm-home-"))));
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  // Async spawn: spawnSync would block this process's event loop and the fake server with it.
  async function cli(args: string[]) {
    const env = { ...process.env, HOME: home, CLAUDE_MANAGER_REPO: REPO, CLAUDE_MANAGER_RELEASE_API: base, CLAUDE_MANAGER_RELEASE_DOWNLOAD: base };
    const proc = Bun.spawn(["bun", "src/cli.ts", ...args], { env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, out, err };
  }

  test("--check reports up to date", async () => {
    publish(`v${pkg.version}`);
    const r = await cli(["update", "--check"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(`up to date (${pkg.version})`);
  });

  test("--check reports newer release", async () => {
    publish(NEW_TAG);
    const r = await cli(["update", "--check"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`99.0.0 available (current ${pkg.version})`);
  });

  test("update from source refuses and suggests git pull", async () => {
    publish(NEW_TAG);
    const r = await cli(["update"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("git pull");
  });
});
