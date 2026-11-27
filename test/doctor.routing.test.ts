import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRouting } from "../src/commands/doctor.routing.ts";
import type { InstallRecord } from "../src/install/install.manifest.ts";
import { useTempHome } from "./test.home.ts";

const ctx = useTempHome();
const ALL_ENV = {
  ANTHROPIC_DEFAULT_OPUS_MODEL: "o",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "s",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "h",
};

function record(files: string[] = []): InstallRecord {
  const settingsPath = join(ctx.claude, "settings.json");
  mkdirSync(ctx.claude, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ env: {} }));
  return {
    scope: "user",
    agentsDir: join(ctx.claude, "agents"),
    settingsPath,
    files: Object.fromEntries(files.map((f) => [f, { sha256: "x" }])),
    settings: { keys: {} },
    installedAt: "",
  };
}

test("clean environment reports no overrides", async () => {
  const checks = await checkRouting([], ["coder"], ALL_ENV, ctx.home);
  expect(checks).toEqual([{ ok: true, label: "model routing: no overrides detected" }]);
});

test("warns on forced subagent model and on a gateway", async () => {
  const env = { ...ALL_ENV, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1", ANTHROPIC_BASE_URL: "https://gw.example" };
  const labels = (await checkRouting([], ["coder"], env, ctx.home)).map((c) => c.label);
  expect(labels.some((l) => l.includes("SUBAGENT_MODEL_FORCE"))).toBe(true);
  expect(labels.some((l) => l.includes("ANTHROPIC_BASE_URL"))).toBe(true);
});

test("warns when a foreign project agent shadows a role, not when it is ours", async () => {
  const path = join(ctx.home, ".claude", "agents", "coder.md");
  mkdirSync(join(ctx.home, ".claude", "agents"), { recursive: true });
  writeFileSync(path, "---\nname: coder\nmodel: inherit\n---\n");
  const foreign = await checkRouting([record()], ["coder"], ALL_ENV, ctx.home);
  expect(foreign.some((c) => c.ok === "warn" && c.label.includes("shadows"))).toBe(true);
  const ours = await checkRouting([record([path])], ["coder"], ALL_ENV, ctx.home);
  expect(ours.some((c) => c.label.includes("shadows"))).toBe(false);
});

test("warns when tier aliases are not mapped in settings or env", async () => {
  const checks = await checkRouting([record()], ["coder"], {}, ctx.home);
  expect(checks.some((c) => c.label.includes("ANTHROPIC_DEFAULT_SONNET_MODEL"))).toBe(true);
});
