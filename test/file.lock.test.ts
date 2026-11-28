import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { CliError } from "../src/cli.error.ts";
import { withFileLock } from "../src/storage/file.lock.ts";
import { tryCreate } from "../src/storage/file.lock.owner.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const lockPath = () => join(ctx.app, "config.lock");
/** Writes a lock file as another process would. */
const foreign = (owner: { pid: number; hostname?: string; startedAt?: string }) => {
  mkdirSync(ctx.app, { recursive: true });
  const full = { hostname: hostname(), startedAt: new Date().toISOString(), ...owner };
  writeFileSync(lockPath(), JSON.stringify(full));
  return full;
};
/** A pid that is certainly dead: a child that already exited. */
const deadPid = async () => {
  const p = Bun.spawn(["true"]);
  await p.exited;
  return p.pid;
};
const ageLock = (ms: number) => {
  const old = new Date(Date.now() - ms);
  utimesSync(lockPath(), old, old);
};
// test-only: pid 1 (launchd/init) is always alive and never ours.
const LIVE_PID = 1;

describe("withFileLock", () => {
  test("holds the lock while fn runs, writing pid/hostname/startedAt, and removes it after", async () => {
    const seen = await withFileLock(lockPath(), async () => JSON.parse(readFileSync(lockPath(), "utf8")));
    expect(seen.pid).toBe(process.pid);
    expect(seen.hostname).toBe(hostname());
    expect(Number.isNaN(Date.parse(seen.startedAt))).toBe(false);
    expect(existsSync(lockPath())).toBe(false);
  });

  test("breaks a lock whose pid is dead on this host", async () => {
    foreign({ pid: await deadPid() });
    expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 200 })).toBe("ran");
    expect(existsSync(lockPath())).toBe(false);
  });

  test("breaks another host's lock once it is older than staleMs", async () => {
    foreign({ pid: LIVE_PID, hostname: "some-other-host", startedAt: new Date(Date.now() - 1_000).toISOString() });
    expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 200, staleMs: 500 })).toBe("ran");
  });

  test("never breaks a live same-host holder by age (e.g. stopped with Ctrl-Z), until it dies", async () => {
    const holder = Bun.spawn(["sleep", "30"]);
    foreign({ pid: holder.pid, startedAt: new Date(Date.now() - 60_000).toISOString() });
    ageLock(60_000);
    const err = await withFileLock(lockPath(), async () => "ran", { timeoutMs: 150, staleMs: 500 }).catch((e: unknown) => e);
    expect((err as CliError).message).toContain(`pid ${holder.pid}`);
    holder.kill();
    await holder.exited;
    expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 200, staleMs: 500 })).toBe("ran");
  });

  test("a future startedAt still ages out, by mtime", async () => {
    foreign({ pid: LIVE_PID, hostname: "some-other-host", startedAt: "3000-01-01T00:00:00.000Z" });
    ageLock(5_000);
    expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 200, staleMs: 1_000 })).toBe("ran");
  });

  for (const shape of ["{}", "5", "[]", "null", '{"pid":"7","hostname":"h","startedAt":"x"}']) {
    test(`a wrong-shape lock (${shape}) is judged by mtime: kept while fresh, broken once old`, async () => {
      mkdirSync(ctx.app, { recursive: true });
      writeFileSync(lockPath(), shape);
      const err = await withFileLock(lockPath(), async () => "ran", { timeoutMs: 100, staleMs: 1_000 }).catch((e: unknown) => e);
      expect((err as CliError).message).toContain("pid unknown");
      ageLock(5_000);
      expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 200, staleMs: 1_000 })).toBe("ran");
    });
  }

  test("breaks a half-written (unparseable) lock by its mtime", async () => {
    mkdirSync(ctx.app, { recursive: true });
    writeFileSync(lockPath(), "");
    ageLock(5_000);
    expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 200, staleMs: 1_000 })).toBe("ran");
  });

  test("a live foreign lock times out with a conflict naming its pid, and is left alone", async () => {
    const owner = foreign({ pid: LIVE_PID });
    let ran = false;
    const err = await withFileLock(lockPath(), async () => { ran = true; }, { timeoutMs: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).reason).toBe("conflict");
    expect((err as CliError).message).toBe(`another claude-manager process is changing config (pid ${LIVE_PID}); try again`);
    expect(ran).toBe(false);
    expect(JSON.parse(readFileSync(lockPath(), "utf8"))).toEqual(owner);
  });

  test("a foreign lock on another host is never judged by pid", async () => {
    foreign({ pid: await deadPid(), hostname: "some-other-host" });
    const err = await withFileLock(lockPath(), async () => undefined, { timeoutMs: 100 }).catch((e: unknown) => e);
    expect((err as CliError).reason).toBe("conflict");
  });

  test("the lock is released after fn throws, and the error propagates", async () => {
    const err = await withFileLock(lockPath(), async () => { throw new Error("boom"); }).catch((e: Error) => e);
    expect(err.message).toBe("boom");
    expect(existsSync(lockPath())).toBe(false);
  });

  test("release doesn't delete a lock that another process took over", async () => {
    let theirs: unknown;
    await withFileLock(lockPath(), async () => {
      theirs = foreign({ pid: LIVE_PID }); // ours was broken as stale and re-taken meanwhile
    });
    expect(JSON.parse(readFileSync(lockPath(), "utf8"))).toEqual(theirs);
  });

  test("callers in one process are serialised by the file", async () => {
    const order: string[] = [];
    const job = (id: string) => withFileLock(lockPath(), async () => {
      order.push(`${id}+`);
      await Bun.sleep(30);
      order.push(`${id}-`);
    });
    await Promise.all([job("a"), job("b")]);
    expect(["a+,a-,b+,b-", "b+,b-,a+,a-"]).toContain(order.join(","));
  });

  test("leaves no break guard behind after breaking a stale lock", async () => {
    foreign({ pid: await deadPid() });
    await withFileLock(lockPath(), async () => undefined, { timeoutMs: 200 });
    expect(existsSync(`${lockPath()}.break`)).toBe(false);
  });

  test("a break guard left by a dead breaker is itself broken", async () => {
    foreign({ pid: await deadPid() });
    writeFileSync(`${lockPath()}.break`, JSON.stringify({ pid: await deadPid(), hostname: hostname(), startedAt: new Date().toISOString() }));
    expect(await withFileLock(lockPath(), async () => "ran", { timeoutMs: 500 })).toBe("ran");
  });
});

describe("tryCreate", () => {
  test("removes the lock file when writing its content fails, and rethrows with context", async () => {
    mkdirSync(ctx.app, { recursive: true });
    const owner = { pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() };
    const enospc = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const err = await tryCreate(lockPath(), owner, async () => { throw enospc; }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(`write lock ${lockPath()}: no space left on device`);
    expect((err as Error).cause).toBe(enospc);
    expect(existsSync(lockPath())).toBe(false);
  });

  test("returns false without touching an existing lock", async () => {
    const theirs = foreign({ pid: LIVE_PID });
    expect(await tryCreate(lockPath(), { ...theirs, pid: process.pid })).toBe(false);
    expect(JSON.parse(readFileSync(lockPath(), "utf8"))).toEqual(theirs);
  });
});
