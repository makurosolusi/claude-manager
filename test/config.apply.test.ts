import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { applyConfig, MAX_CONFIG_BACKUPS } from "../src/config/config.apply.ts";
import { type Config, configPath, loadConfig } from "../src/config/config.store.ts";
import { loadManifest } from "../src/install/install.manifest.ts";
import { install } from "../src/install/install.service.ts";
import type { Target } from "../src/install/install.target.ts";
import { addRole, setRoleModel } from "../src/roles/roles.service.ts";
import type { AgentInput } from "../src/server/agents.types.ts";
import { sha256 } from "../src/storage/json.file.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};
const project = (): Target => {
  const dir = join(ctx.home, "proj", ".claude");
  return { scope: "project", agentsDir: join(dir, "agents"), settingsPath: join(dir, "settings.json") };
};
const userAgents = () => join(ctx.claude, "agents");
const UI_UX: AgentInput = { name: "ui-ux", description: "Designs UI", model: { tier: "work" }, tools: ["Read"] };
/** coder.md is rewritten in place (works in a read-only dir), then ui-ux.md is created (fails in a read-only dir). */
const change = (c: Config) => addRole(setRoleModel(c, "coder", { pin: "claude-x-1" }), UI_UX);

/** User + project install, config.json written. */
async function seedTwoInstalls() {
  await quiet(["install"]);
  await install(project(), await loadConfig());
  await applyConfig((c) => c);
}

/** Every file a manifest record owns hashes to its recorded sha (no false "edited by hand"). */
async function expectManifestMatchesDisk() {
  for (const rec of Object.values((await loadManifest()).installs)) {
    for (const [path, f] of Object.entries(rec.files)) {
      if (existsSync(path)) expect([path, sha256(readFileSync(path, "utf8"))]).toEqual([path, f.sha256]);
    }
  }
}

const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), "utf8")]));

describe("rollback across installs", () => {
  test("second install fails: config, files and manifest of BOTH installs match the old config", async () => {
    await seedTwoInstalls();
    const config = readFileSync(configPath(), "utf8");
    const before = { user: snapshot(userAgents()), proj: snapshot(project().agentsDir) };
    chmodSync(project().agentsDir, 0o555);
    let err: Error | undefined;
    try {
      err = await applyConfig(change).then(() => undefined, (e: Error) => e);
    } finally {
      chmodSync(project().agentsDir, 0o755);
    }
    expect(err?.message).toStartWith("apply config: ");
    expect(err?.message).not.toContain("rollback failed");
    expect(readFileSync(configPath(), "utf8")).toBe(config);
    expect(snapshot(userAgents())).toEqual(before.user);
    expect(snapshot(project().agentsDir)).toEqual(before.proj);
    await expectManifestMatchesDisk();
    expect((await applyConfig(change)).applied).toBe(2); // no "edited by hand" on the next apply
    expect(existsSync(join(project().agentsDir, "ui-ux.md"))).toBe(true);
  });

  test("a mid-install failure records the files it wrote, so going back is not a conflict", async () => {
    await seedTwoInstalls();
    const old = await loadConfig();
    const coder = join(project().agentsDir, "coder.md");
    const oldCoder = readFileSync(coder, "utf8");
    chmodSync(project().agentsDir, 0o555);
    try {
      await expect(install(project(), change(old))).rejects.toThrow();
    } finally {
      chmodSync(project().agentsDir, 0o755);
    }
    expect(readFileSync(coder, "utf8")).not.toBe(oldCoder); // written before the failure
    await expectManifestMatchesDisk();
    await install(project(), old); // would throw "were edited" if the manifest still had the old sha
    expect(readFileSync(coder, "utf8")).toBe(oldCoder);
  });
});

describe("config backups", () => {
  test(`keeps the newest ${MAX_CONFIG_BACKUPS} config backups and never touches install backups`, async () => {
    await quiet(["install"]);
    await applyConfig((c) => c);
    const dir = join(ctx.app, "backups");
    mkdirSync(dir, { recursive: true });
    const fake = Array.from({ length: 25 }, (_, i) => `2020-01-01T00-00-${String(i).padStart(2, "0")}-000Z-abcdef12-config.json`);
    for (const f of fake) writeFileSync(join(dir, f), "{}\n");
    const keep = ["2019-01-01T00-00-00-000Z-abcdef12-coder.md", "2019-01-01T00-00-00-000Z-abcdef12-user-settings.json"];
    for (const f of keep) writeFileSync(join(dir, f), "x");
    await applyConfig((c) => addRole(c, UI_UX));
    const configs = readdirSync(dir).filter((f) => f.endsWith("-config.json")).sort();
    expect(configs).toHaveLength(MAX_CONFIG_BACKUPS);
    expect(configs.at(-1)!.startsWith("2020-")).toBe(false); // the backup just taken survives
    expect(configs).not.toContain(fake[0]!);
    for (const f of keep) expect(existsSync(join(dir, f))).toBe(true);
  });
});
