import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configLockPath } from "../src/config/config.apply.ts";
import { loadConfig } from "../src/config/config.store.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const ROLES_PER_WRITER = 5;
const src = (f: string) => resolve(import.meta.dir, "../src", f);

/** A separate process that adds ROLES_PER_WRITER custom roles one applyConfig at a time. */
const writerScript = () => `
import { applyConfig } from ${JSON.stringify(src("config/config.apply.ts"))};
import { addRole } from ${JSON.stringify(src("roles/roles.service.ts"))};
const prefix = process.argv[2];
for (let i = 0; i < ${ROLES_PER_WRITER}; i++) {
  await applyConfig((c) => addRole(c, { name: prefix + "-" + i, description: "role " + i, model: { tier: "work" }, tools: ["Read"] }));
}
`;

test("two processes writing config concurrently both keep their updates", async () => {
  const script = join(ctx.home, "writer.ts");
  writeFileSync(script, writerScript());
  const spawn = (prefix: string) => Bun.spawn([process.execPath, script, prefix], { env: { ...process.env }, stderr: "pipe" });
  const procs = [spawn("alpha"), spawn("beta")];
  const codes = await Promise.all(procs.map((p) => p.exited));
  const errs = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
  expect([codes, errs]).toEqual([[0, 0], ["", ""]]);
  const roles = Object.keys((await loadConfig()).customRoles).sort();
  const want = ["alpha", "beta"].flatMap((p) => Array.from({ length: ROLES_PER_WRITER }, (_, i) => `${p}-${i}`)).sort();
  expect(roles).toEqual(want);
  expect(existsSync(configLockPath())).toBe(false);
}, 30_000);
