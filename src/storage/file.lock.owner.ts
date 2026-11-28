import { open, rm, type FileHandle } from "node:fs/promises";
import { hostname } from "node:os";

/** What the lock file holds; pid + startedAt identify one acquisition. */
export interface LockOwner {
  pid: number;
  hostname: string;
  startedAt: string;
}

/** One read of a lock file: stat and content from the same open fd, so they describe the same inode. */
export interface LockSnapshot {
  ino: number;
  dev: number;
  mtimeMs: number;
  text: string;
  /** null when the content is not a valid owner (empty, half-written, or the wrong shape). */
  owner: LockOwner | null;
}

export const code = (err: unknown) => (err as NodeJS.ErrnoException)?.code;
export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const sameOwner = (a: LockOwner | null | undefined, b: LockOwner) => !!a && a.pid === b.pid && a.startedAt === b.startedAt;
/** Same inode with the same mtime and content: guards against an inode number reused by a newer lock file. */
export const sameFile = (a: LockSnapshot, b: LockSnapshot) =>
  a.ino === b.ino && a.dev === b.dev && a.mtimeMs === b.mtimeMs && a.text === b.text;

/** Parses and shape-checks lock content; anything that is not {pid > 0, hostname, parseable startedAt} is null. */
export function parseOwner(text: string): LockOwner | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null; // empty or half-written: the caller judges it by mtime instead
  }
  const o = v as Partial<LockOwner> | null;
  const valid = typeof o === "object" && o !== null && Number.isInteger(o.pid) && o.pid! > 0
    && typeof o.hostname === "string" && typeof o.startedAt === "string" && !Number.isNaN(Date.parse(o.startedAt));
  return valid ? (o as LockOwner) : null;
}

/** undefined = no lock file. */
export async function readSnapshot(path: string): Promise<LockSnapshot | undefined> {
  let h: FileHandle;
  try {
    h = await open(path, "r");
  } catch (err) {
    if (code(err) === "ENOENT") return undefined;
    throw new Error(`open lock ${path}: ${message(err)}`, { cause: err });
  }
  try {
    const s = await h.stat();
    const text = await h.readFile("utf8");
    return { ino: s.ino, dev: s.dev, mtimeMs: s.mtimeMs, text, owner: parseOwner(text) };
  } catch (err) {
    throw new Error(`read lock ${path}: ${message(err)}`, { cause: err });
  } finally {
    await h.close();
  }
}

/** kill(pid, 0) probes without signalling: ESRCH = gone, EPERM = alive but another user's. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (code(err) === "ESRCH") return false;
    if (code(err) === "EPERM") return true;
    throw new Error(`probe lock owner pid ${pid}: ${message(err)}`, { cause: err });
  }
}

/**
 * Same host: stale only when the pid is dead. A live holder is never broken by age (it may be stopped with Ctrl-Z or on
 * a sleeping laptop, and will resume writing). Other host, or owner unknown: stale after staleMs. Age counts from the
 * earlier of startedAt and mtime, so a future startedAt (clock skew) still ages out by mtime.
 * ponytail: a dead holder whose pid was reused by a live process blocks writers until that process exits; the conflict
 * error names the pid so the user can remove the lock. Fix with a process start-time check if it ever bites.
 */
export function isStale(snap: LockSnapshot, staleMs: number, now = Date.now()): boolean {
  const o = snap.owner;
  if (o && o.hostname === hostname()) return !pidAlive(o.pid);
  const born = o ? Math.min(Date.parse(o.startedAt), snap.mtimeMs) : snap.mtimeMs;
  return now - born > staleMs;
}

export type LockWriter = (h: FileHandle, text: string) => Promise<void>;
const writeAll: LockWriter = (h, text) => h.writeFile(text, "utf8");

/**
 * Exclusive create (O_CREAT|O_EXCL); false when someone else holds the lock. If the content write fails after the
 * create, the empty file is removed before rethrowing, so a failed write does not leave an owner-less lock behind.
 * `write` is a test seam for injecting that failure.
 */
export async function tryCreate(path: string, owner: LockOwner, write: LockWriter = writeAll): Promise<boolean> {
  let h: FileHandle;
  try {
    h = await open(path, "wx");
  } catch (err) {
    if (code(err) === "EEXIST") return false;
    throw new Error(`create lock ${path}: ${message(err)}`, { cause: err });
  }
  let failure: unknown;
  await write(h, JSON.stringify(owner)).catch((err: unknown) => { failure = err; });
  await h.close().catch((err: unknown) => { failure ??= err; }); // a failed close may mean the content never landed
  if (failure === undefined) return true;
  await rm(path, { force: true }).catch((rmErr: unknown) => {
    throw new Error(`write lock ${path}: ${message(failure)}; removing it also failed: ${message(rmErr)}`, { cause: failure });
  });
  throw new Error(`write lock ${path}: ${message(failure)}`, { cause: failure });
}
