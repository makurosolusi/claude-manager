import { link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { CliError } from "../cli.error.ts";

/** How long a writer waits for another process's lock before giving up with a conflict. */
export const LOCK_TIMEOUT_MS = 10_000;
/** A lock older than this is treated as abandoned (no config write takes anywhere near this long). */
export const LOCK_STALE_MS = 120_000;
const RETRY_MIN_MS = 10;
const RETRY_MAX_MS = 200;

export interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
}

/** What the lock file holds; pid + startedAt identify one acquisition. */
export interface LockOwner {
  pid: number;
  hostname: string;
  startedAt: string;
}

const code = (err: unknown) => (err as NodeJS.ErrnoException)?.code;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sameOwner = (a: LockOwner | null | undefined, b: LockOwner) => !!a && a.pid === b.pid && a.startedAt === b.startedAt;

/** Exclusive create (O_CREAT|O_EXCL); false when someone else holds the lock. */
async function tryCreate(path: string, owner: LockOwner): Promise<boolean> {
  try {
    await writeFile(path, JSON.stringify(owner), { flag: "wx" });
    return true;
  } catch (err) {
    if (code(err) === "EEXIST") return false;
    throw new Error(`create lock ${path}: ${message(err)}`, { cause: err });
  }
}

/** undefined = no lock file; null = present but not (yet) valid JSON, e.g. caught between create and write. */
async function readOwner(path: string): Promise<LockOwner | null | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (code(err) === "ENOENT") return undefined;
    throw new Error(`read lock ${path}: ${message(err)}`, { cause: err });
  }
  try {
    return JSON.parse(text) as LockOwner;
  } catch {
    return null; // half-written lock: judged by its mtime instead (see isStale)
  }
}

/** kill(pid, 0) probes without signalling: ESRCH = gone, EPERM = alive but another user's. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (code(err) === "ESRCH") return false;
    if (code(err) === "EPERM") return true;
    throw new Error(`probe lock owner pid ${pid}: ${message(err)}`, { cause: err });
  }
}

async function isStale(path: string, owner: LockOwner | null, staleMs: number): Promise<boolean> {
  if (owner === null) {
    const s = await stat(path).catch((err: unknown) => (code(err) === "ENOENT" ? undefined : Promise.reject(err)));
    return s !== undefined && Date.now() - s.mtimeMs > staleMs;
  }
  if (Date.now() - Date.parse(owner.startedAt) > staleMs) return true;
  return owner.hostname === hostname() && !pidAlive(owner.pid);
}

/**
 * Race-safe break: rename the stale file aside (only one breaker's rename succeeds), then check that what was moved is
 * the owner judged stale. If a fresh lock was moved instead (another breaker won and re-created in between), link it back.
 * ponytail: if a third process created a lock in that sub-millisecond window too, the link fails and the moved owner loses
 * its lock; needs three concurrent writers on an already-stale lock.
 */
async function breakLock(path: string, stale: LockOwner | null): Promise<void> {
  const aside = `${path}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    await rename(path, aside);
  } catch (err) {
    if (code(err) === "ENOENT") return; // another breaker got there first
    throw new Error(`break stale lock ${path}: ${message(err)}`, { cause: err });
  }
  const moved = await readOwner(aside);
  if (stale !== null && moved && !sameOwner(moved, stale)) {
    await link(aside, path).catch((err: unknown) => {
      if (code(err) !== "EEXIST") throw new Error(`restore lock ${path}: ${message(err)}`, { cause: err });
    });
  }
  await rm(aside, { force: true });
}

/** Removes the lock only if it is still ours (it may have been broken as stale and re-taken by another process). */
async function release(path: string, owner: LockOwner): Promise<void> {
  if (sameOwner(await readOwner(path), owner)) await rm(path, { force: true });
}

/**
 * Cross-process advisory lock: runs `fn` while holding `path` (created exclusively, holding {pid, hostname, startedAt}).
 * Waits with backoff up to `timeoutMs`, breaking locks whose pid is dead (same host) or that are older than `staleMs`.
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  await mkdir(dirname(path), { recursive: true });
  const stamp = (): LockOwner => ({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() });
  let owner = stamp();
  const deadline = Date.now() + timeoutMs;
  let delay = RETRY_MIN_MS;
  while (!(await tryCreate(path, (owner = stamp())))) {
    const current = await readOwner(path);
    if (current === undefined) continue; // released between our create and read
    if (await isStale(path, current, staleMs)) {
      await breakLock(path, current);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new CliError(`another claude-manager process is changing config (pid ${current?.pid ?? "unknown"}); try again`, 1, "conflict");
    }
    await Bun.sleep(delay);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  }
  try {
    return await fn();
  } finally {
    await release(path, owner);
  }
}
