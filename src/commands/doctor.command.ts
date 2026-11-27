import { loadConfig } from "../config/config.store.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { parseSettings, readText } from "../install/install.target.ts";
import { resolveRoles } from "../roles/roles.registry.ts";
import { sha256 } from "../storage/json.file.ts";
import type { Command } from "./command.types.ts";

type Check = { ok: boolean | "warn"; label: string };

async function checkClaude(): Promise<Check> {
  const bin = Bun.which("claude");
  if (!bin) return { ok: false, label: "claude CLI not found in PATH" };
  const proc = Bun.spawnSync([bin, "--version"]);
  return { ok: proc.exitCode === 0, label: `claude ${proc.stdout.toString().trim() || "(version unknown)"}` };
}

async function checkInstalls(): Promise<Check[]> {
  const installs = Object.values((await loadManifest()).installs);
  if (!installs.length) return [{ ok: "warn", label: 'not installed yet: run "claude-manager install"' }];
  const checks: Check[] = [];
  for (const rec of installs) {
    let missing = 0;
    let edited = 0;
    for (const [path, file] of Object.entries(rec.files)) {
      const text = await readText(path);
      if (text === undefined) missing++;
      else if (sha256(text) !== file.sha256) edited++;
    }
    const total = Object.keys(rec.files).length;
    const healthy = missing === 0 && edited === 0;
    checks.push({
      ok: healthy || "warn",
      label: `${rec.scope} scope: ${total} roles${healthy ? "" : ` (${missing} missing, ${edited} edited — re-run install)`}`,
    });
    try {
      parseSettings(await readText(rec.settingsPath), rec.settingsPath);
      checks.push({ ok: true, label: `${rec.settingsPath} is valid JSON` });
    } catch (err) {
      checks.push({ ok: false, label: (err as Error).message });
    }
  }
  return checks;
}

function checkProvider(): Check {
  const other = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"].filter((k) => process.env[k]);
  return other.length
    ? { ok: "warn", label: `${other.join(", ")} set: tier model IDs must be valid for that provider` }
    : { ok: true, label: "provider: Anthropic API" };
}

export const doctorCommand: Command = {
  name: "doctor",
  summary: "Check Claude Code, installs and settings",
  usage: "Usage: claude-manager doctor\n\nRuns health checks and exits 1 if any check fails.",
  async run() {
    const config = await loadConfig();
    const checks = [
      await checkClaude(),
      { ok: true, label: `${resolveRoles(config).length} roles enabled` } as Check,
      ...(await checkInstalls()),
      checkProvider(),
    ];
    for (const c of checks) console.log(`${c.ok === true ? "ok  " : c.ok === "warn" ? "warn" : "FAIL"}  ${c.label}`);
    return checks.some((c) => c.ok === false) ? 1 : 0;
  },
};
