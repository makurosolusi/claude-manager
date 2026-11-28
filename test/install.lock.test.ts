import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installCommand } from "../src/commands/install.command.ts";
import { uninstallCommand } from "../src/commands/uninstall.command.ts";
import { configLockPath } from "../src/config/config.apply.ts";
import { loadManifest } from "../src/install/install.manifest.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const HOLD_MS = 800; // test-only
const src = (f: string) => resolve(import.meta.dir, "../src", f);

/** Spawns a process that holds the config lock for HOLD_MS and prints "held" once it has it. */
async function holdLock() {
  const script = join(ctx.home, "holder.ts");
  writeFileSync(script, `
import { withConfigLock } from ${JSON.stringify(src("config/config.apply.ts"))};
await withConfigLock(async () => { console.log("held"); await Bun.sleep(${HOLD_MS}); });
`);
  const proc = Bun.spawn([process.execPath, script], { env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("held");
  return proc;
}

const quiet = async <T>(fn: () => T | Promise<T>) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

for (const [name, command, args, check] of [
  ["install", installCommand, [], async () => expect(Object.keys((await loadManifest()).installs)).toHaveLength(1)],
  ["uninstall", uninstallCommand, [], async () => expect(Object.keys((await loadManifest()).installs)).toHaveLength(0)],
] as const) {
  test(`${name} waits for another process holding the config lock, then succeeds`, async () => {
    if (name === "uninstall") await quiet(() => installCommand.run([]));
    const holder = await holdLock();
    const started = Date.now();
    expect(await quiet(() => command.run([...args]))).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS / 2);
    await holder.exited;
    await check();
    expect(existsSync(configLockPath())).toBe(false);
  }, 30_000);
}
