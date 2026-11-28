import { CliError } from "../cli.error.ts";
import { loadConfig } from "../config/config.store.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { parseSettings, readText } from "../install/install.target.ts";
import { getKey } from "../install/settings.merge.ts";
import { effectivePolicy } from "../policy/policy.effective.ts";
import { CAPABILITIES } from "../policy/policy.presets.ts";
import type { PolicyRow } from "../policy/policy.types.ts";

/** "ok" when our recorded hook group is still in the settings file, "missing"/"edited" otherwise, "none" when never applied. */
async function hookStatus(): Promise<{ status: string; path?: string }> {
  const rec = (await loadManifest()).policy;
  if (!rec) return { status: "none" };
  try {
    const groups = getKey(parseSettings(await readText(rec.settingsPath), rec.settingsPath), "hooks.PreToolUse");
    const found = Array.isArray(groups) && rec.hook ? groups.some((g) => Bun.deepEquals(g, rec.hook!.group)) : false;
    return { status: found ? "ok" : "missing", path: rec.settingsPath };
  } catch (err) {
    throw new CliError(`cannot read policy settings ${rec.settingsPath}: ${(err as Error).message}`, 1, "server");
  }
}

/** Matrix cell: decision, `*` when it is an override (so `ask*` differs from the preset). */
export const cell = (r: PolicyRow, cap: (typeof CAPABILITIES)[number]) => `${r.cells[cap].decision}${r.cells[cap].source === "override" ? "*" : ""}`;

export function matrixTable(rows: PolicyRow[]): string {
  const head = ["row", ...CAPABILITIES];
  const body = rows.map((r) => [r.row, ...CAPABILITIES.map((c) => cell(r, c))]);
  const widths = head.map((_, i) => Math.max(...[head, ...body].map((row) => row[i]!.length)));
  return [head, ...body].map((row) => row.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n");
}

export async function showPolicy(json: boolean): Promise<number> {
  const config = await loadConfig();
  const rows = effectivePolicy(config);
  const policy = config.policy;
  const hook = await hookStatus();
  if (json) {
    console.log(JSON.stringify({ policy: policy ?? null, hook, rows }, null, 2));
    return 0;
  }
  if (!policy) {
    console.log('policy: not set up (matrix below is the "balanced" preview). Run "claude-manager policy apply balanced"');
  } else {
    console.log(`policy: ${policy.enabled ? "enabled" : "disabled"}  preset: ${policy.preset}  scope: ${policy.scope}`);
    if (policy.projectDir) console.log(`project: ${policy.projectDir}`);
    const escalate = policy.escalate === true;
    console.log(`escalate: ${escalate ? "on" : "off"}`);
    if (escalate) console.log("  worker asks and defaults (except read) go to the manager; only the manager prompts you");
    if (policy.defaultMode) console.log(`defaultMode: ${policy.defaultMode}`);
  }
  console.log(`settings: ${hook.path ?? "-"}  hook: ${hook.status}`);
  console.log(`\n${matrixTable(rows)}\n\n* = override of the preset`);
  return 0;
}
