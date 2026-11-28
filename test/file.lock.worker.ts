// test-only: one contender for the multi-process lock stress test (file.lock.stress.test.ts).
// argv: lockPath logPath startAtMs holdMs. Appends "+" on entry and "-" on exit with O_APPEND so lines never interleave.
import { appendFileSync } from "node:fs";
import { withFileLock } from "../src/storage/file.lock.ts";

const [lockPath, logPath, startAt, holdMs] = process.argv.slice(2) as [string, string, string, string];
await Bun.sleep(Math.max(0, Number(startAt) - Date.now())); // line every contender up on the same instant
await withFileLock(lockPath, async () => {
  appendFileSync(logPath, `+${process.pid}\n`);
  await Bun.sleep(Number(holdMs));
  appendFileSync(logPath, `-${process.pid}\n`);
}, { timeoutMs: 20_000 });
