import { join } from "node:path";
import { TIER_ENV, TIERS } from "../config/config.store.ts";
import type { InstallRecord } from "../install/install.manifest.ts";
import { parseSettings, readText } from "../install/install.target.ts";

export type RoutingCheck = { ok: boolean | "warn"; label: string };

const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * Detects conditions that make a role run on a different model than its tier says:
 * forced subagent model, a gateway that may remap models, project agents that shadow ours,
 * and tier aliases that nothing maps to a model ID.
 */
export async function checkRouting(
  installs: InstallRecord[],
  roleNames: string[],
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): Promise<RoutingCheck[]> {
  const out: RoutingCheck[] = [];
  if (TRUTHY.test(env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE ?? "")) {
    out.push({
      ok: "warn",
      label:
        "CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set: every role's model is ignored. Unset it (shell profile / Orca / FleetView env) to restore per-role routing",
    });
  }
  if (env.ANTHROPIC_BASE_URL) {
    out.push({
      ok: "warn",
      label:
        "ANTHROPIC_BASE_URL is set: a gateway can serve a different model than the one requested. Compare requested vs served in the dashboard; unset it to rule the gateway out",
    });
  }
  const owned = new Set(installs.flatMap((r) => Object.keys(r.files)));
  for (const name of roleNames) {
    const path = join(cwd, ".claude", "agents", `${name}.md`);
    if (!owned.has(path) && (await Bun.file(path).exists())) {
      out.push({
        ok: "warn",
        label: `${path} shadows the installed "${name}" role (project scope wins). Remove it or run "claude-manager install --scope project"`,
      });
    }
  }
  for (const rec of installs) {
    const settingsEnv = (parseSettings(await readText(rec.settingsPath), rec.settingsPath).env ?? {}) as Record<string, unknown>;
    const unmapped = TIERS.map((t) => TIER_ENV[t]).filter((k) => !settingsEnv[k] && !env[k]);
    if (unmapped.length) {
      out.push({
        ok: "warn",
        label: `${rec.settingsPath}: ${unmapped.join(", ")} not set, so those aliases resolve to Claude Code defaults. Re-run "claude-manager install"`,
      });
    }
  }
  if (!out.length) out.push({ ok: true, label: "model routing: no overrides detected" });
  return out;
}
