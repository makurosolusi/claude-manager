import { chmodSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CliError } from "../cli.error.ts";
import { GITHUB_API, GITHUB_DOWNLOAD, RELEASE_REPO, SUMS_ASSET } from "./update.config.ts";

const BIN = "claude-manager";
const EXEC_MODE = 0o755;
const PLATFORMS: Record<string, string> = { darwin: "darwin", linux: "linux" };
const ARCHES: Record<string, string> = { x64: "x64", arm64: "arm64" };
const BUN_RUNTIMES = new Set(["bun", "bun.exe"]);

/** Where releases are fetched from; defaults come from update.config.ts. */
export interface ReleaseSource {
  repo: string;
  api: string;
  download: string;
}

const defaultSource = (): ReleaseSource => ({ repo: RELEASE_REPO, api: GITHUB_API, download: GITHUB_DOWNLOAD });

function parseVersion(v: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new CliError(`invalid version "${v}": expected major.minor.patch`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Numeric semver compare (major.minor.patch, optional "v"): -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** Release asset name for a platform/arch, e.g. claude-manager-darwin-arm64. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string {
  const os = PLATFORMS[platform];
  const cpu = ARCHES[arch];
  if (!os || !cpu) throw new CliError(`no release binary for ${platform}-${arch}; supported: darwin/linux on x64/arm64`);
  return `${BIN}-${os}-${cpu}`;
}

/** True when running as a compiled binary rather than `bun src/cli.ts`. */
export function isCompiledBinary(execPath: string = process.execPath): boolean {
  return !BUN_RUNTIMES.has(basename(execPath).toLowerCase());
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
  if (!res.ok) throw new CliError(`GET ${url} failed: HTTP ${res.status}`);
  return res;
}

/** Tag name (e.g. "v0.2.0") of the latest published release. */
export async function fetchLatestTag(src: ReleaseSource = defaultSource()): Promise<string> {
  const url = `${src.api}/repos/${src.repo}/releases/latest`;
  const body = (await (await get(url)).json()) as { tag_name?: unknown };
  if (typeof body.tag_name !== "string") throw new CliError(`GET ${url}: response has no tag_name`);
  return body.tag_name;
}

function expectedSha(sums: string, asset: string, url: string): string {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && m[2] === asset) return m[1]!.toLowerCase();
  }
  throw new CliError(`${asset} is not listed in ${url}`);
}

/** Downloads `asset` of release `tag`, verifies its sha256 and atomically replaces `target`. */
export async function installRelease(tag: string, target: string, asset: string, src: ReleaseSource = defaultSource()): Promise<void> {
  const base = `${src.download}/${src.repo}/releases/download/${tag}`;
  const sumsUrl = `${base}/${SUMS_ASSET}`;
  const want = expectedSha(await (await get(sumsUrl)).text(), asset, sumsUrl);
  const bytes = await (await get(`${base}/${asset}`)).arrayBuffer();
  const got = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (got !== want) throw new CliError(`checksum mismatch for ${asset} (${tag}): expected ${want}, got ${got}; nothing was changed`);

  // Same directory as the target so rename() stays on one filesystem and is atomic.
  const tmp = join(dirname(target), `.${basename(target)}.update-${process.pid}`);
  try {
    await Bun.write(tmp, bytes);
    chmodSync(tmp, EXEC_MODE);
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new CliError(`could not replace ${target}: ${(err as Error).message}`);
  }
}
