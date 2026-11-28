import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const WORKER = join(import.meta.dir, "file.lock.worker.ts");
const RUNS = Number(process.env.LOCK_STRESS_RUNS ?? 20); // test-only: raise to stress harder
const HOLD_MS = 30;

/** Highest number of processes inside the lock at once, from the +pid / -pid lines. */
const maxHolders = (log: string) => {
  let now = 0, max = 0;
  for (const line of log.split("\n").filter(Boolean)) {
    now += line.startsWith("+") ? 1 : -1;
    max = Math.max(max, now);
  }
  return max;
};

test(`an empty stale lock broken by 3-8 processes at once is held by one at a time (${RUNS} runs)`, async () => {
  const counts: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const procs = 3 + (run % 6);
    const dir = join(ctx.app, `run-${run}`);
    mkdirSync(dir, { recursive: true });
    const lock = join(dir, "config.lock"), log = join(dir, "holders.log");
    writeFileSync(lock, ""); // a lock whose writer died between create and write
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(lock, old, old);
    writeFileSync(log, "");
    const startAt = String(Date.now() + 400);
    const children = Array.from({ length: procs }, () =>
      Bun.spawn(["bun", WORKER, lock, log, startAt, String(HOLD_MS)], { stderr: "pipe" }));
    const codes = await Promise.all(children.map((c) => c.exited));
    expect(codes.every((c) => c === 0)).toBe(true);
    const text = readFileSync(log, "utf8");
    expect(text.split("\n").filter(Boolean).length).toBe(procs * 2);
    counts.push(maxHolders(text));
  }
  console.log(`max concurrent holders per run: ${counts.join(",")}`);
  expect(Math.max(...counts)).toBe(1);
}, 120_000);
