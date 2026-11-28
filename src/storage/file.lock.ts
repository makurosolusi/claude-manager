import { mkdir, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { CliError } from "../cli.error.ts";
import { isStale, message, readSnapshot, sameFile, sameOwner, tryCreate, type LockOwner, type LockSnapshot } from "./file.lock.owner.ts";

/** How long a writer waits for another process's lock before giving up with a conflict. */
export const LOCK_TIMEOUT_MS = 10_000;
/** A lock older than this (other host, or owner unknown) is treated as abandoned; no config write takes this long. */
export const LOCK_STALE_MS = 120_000;
const RETRY_MIN_MS = 10;
const RETRY_MAX_MS = 200;

export interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
}

const stamp = (): LockOwner => ({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() });

/** Unlinks `path` only if it is still the very file judged stale (same inode, mtime and content). */
async function removeIfSame(path: string, judged: LockSnapshot): Promise<void> {
  const now = await readSnapshot(path);
  if (!now || !sameFile(now, judged)) return; // already broken, released or re-taken: the caller re-reads it
  await rm(path, { force: true }).catch((err: unknown) => {
    throw new Error(`break stale lock ${path}: ${message(err)}`, { cause: err });
  });
}

/**
 * Breaks a stale lock under a second lock, `<path>.break`, so breakers take turns. Inside it the lock is re-read and
 * unlinked only if it is still the file judged stale. Without the guard, two breakers that judged the same stale file
 * could each remove whatever sits at the path, including a fresh lock the other just created, and both then hold it.
 * Nothing is ever moved away and put back, so a holder's release always finds its own lock.
 * Returns false when another breaker holds the guard (the caller backs off); a guard left by a breaker that died is
 * itself broken by the same staleness rules.
 * ponytail: re-read and unlink are two syscalls, not one. A new lock is wrongly unlinked only if, in that gap, the
 * "stale" file is removed by something outside the guard and a new lock is created: a live other-host holder that was
 * aged out releasing at that instant, or two processes breaking a dead breaker's guard at once. Closing it fully needs
 * flock(2), which Bun does not expose without FFI.
 */
async function breakLock(path: string, judged: LockSnapshot, staleMs: number): Promise<boolean> {
  const guard = `${path}.break`;
  if (!(await tryCreate(guard, stamp()))) {
    const g = await readSnapshot(guard);
    if (g && isStale(g, staleMs)) await removeIfSame(guard, g);
    return false;
  }
  try {
    await removeIfSame(path, judged);
    return true;
  } finally {
    await rm(guard, { force: true }).catch((err: unknown) => {
      throw new Error(`release break guard ${guard}: ${message(err)}`, { cause: err });
    });
  }
}

/**
 * Removes the lock only if it is still ours. A same-host lock with a live pid is never broken, so this read-then-unlink
 * can only lose to an other-host breaker that aged our lock out, which takes a write longer than staleMs.
 */
async function release(path: string, owner: LockOwner): Promise<void> {
  if (!sameOwner((await readSnapshot(path))?.owner, owner)) return;
  await rm(path, { force: true }).catch((err: unknown) => {
    throw new Error(`release lock ${path}: ${message(err)}`, { cause: err });
  });
}

/**
 * Cross-process advisory lock: runs `fn` while holding `path` (created exclusively, holding {pid, hostname, startedAt}).
 * Waits with backoff up to `timeoutMs`. Breaks a lock whose pid is dead (same host), or that is older than `staleMs`
 * when its owner is on another host or unreadable (empty, half-written, wrong shape).
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  await mkdir(dirname(path), { recursive: true });
  let owner = stamp();
  const deadline = Date.now() + timeoutMs;
  let delay = RETRY_MIN_MS;
  while (!(await tryCreate(path, (owner = stamp())))) {
    const current = await readSnapshot(path);
    if (current === undefined) continue; // released between our create and read
    if (isStale(current, staleMs) && (await breakLock(path, current, staleMs))) continue;
    if (Date.now() >= deadline) {
      const pid = current.owner?.pid ?? "unknown";
      throw new CliError(`another claude-manager process is changing config (pid ${pid}); try again`, 1, "conflict");
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
