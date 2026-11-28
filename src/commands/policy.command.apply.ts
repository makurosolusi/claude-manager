import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CliError } from "../cli.error.ts";
import type { ConfigBuild } from "../config/config.apply.ts";
import { loadConfig } from "../config/config.store.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { applyPolicy, previewPolicy, type PolicyPlan } from "../policy/policy.apply.ts";
import { matrixTable } from "./policy.command.show.ts";

/** Nearest ancestor of `from` holding `.git` (the project scope target must be the repo root). */
export function gitRoot(from = process.cwd()): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) throw new CliError(`${from} is not inside a git repository: project scope needs one`);
  }
}

/** `escalate: on` plus what changed against the stored value; absent = a v0.4.0 policy, or a first setup (no note). */
export function escalateLine(plan: PolicyPlan, stored: { escalate?: boolean } | undefined): string | null {
  if (!plan.snapshot) return null;
  const now = plan.snapshot.escalate;
  const note = !stored ? "" : stored.escalate === undefined ? " (new in 0.4.1; was not set)" : stored.escalate !== now ? ` (was ${stored.escalate ? "on" : "off"})` : "";
  return `escalate: ${now ? "on" : "off"}${note}`;
}

function printPlan(plan: PolicyPlan, escalate: string | null): void {
  console.log(`settings: ${plan.settingsPath ?? "-"}`);
  if (!plan.changes.length) console.log("  (no settings changes)");
  for (const c of plan.changes) {
    const sign = { add: "+", remove: "-", keep: "=", set: "~" }[c.op];
    const value = typeof c.value === "string" ? c.value : JSON.stringify(c.value);
    console.log(`  ${sign} ${c.path === plan.settingsPath ? "" : `${c.path}: `}${c.list ?? "key"}: ${value}`);
  }
  console.log(plan.hook ? `hook: PreToolUse ${plan.hook.matcher}` : "hook: none");
  console.log(plan.snapshot ? `snapshot: ${plan.compiledPath}` : `snapshot: removed (${plan.compiledPath})`);
  if (escalate) console.log(escalate);
  if (plan.snapshot) console.log(`\n${matrixTable(plan.rows)}`);
}

/** CLI option for a source-run hook (development only); parse it with `DEV_HOOK_OPTION` and pass it as `devHook`. */
export const DEV_HOOK_OPTION = { "dev-hook": { type: "boolean", default: false } } as const;

/**
 * Preview, optionally confirm, then write through the shared `applyPolicy` path (same as the dashboard API).
 * `devHook` = `--dev-hook`: allow a source-run hook (see policy.service.ts `hookCommand`).
 */
export async function runPolicyChange(
  build: ConfigBuild,
  opts: { dryRun: boolean; confirm: boolean; yes: boolean; done: string; devHook?: boolean },
): Promise<number> {
  const before = await loadConfig();
  const plan = await previewPolicy(await build(before, await loadManifest()), { devHook: opts.devHook });
  const escalate = escalateLine(plan, before.policy);
  printPlan(plan, escalate);
  if (opts.dryRun) {
    console.log("\nDry run, nothing written.");
    return 0;
  }
  if (opts.confirm && !opts.yes) {
    if (!process.stdin.isTTY) throw new CliError("not a terminal: pass --yes to apply without the prompt");
    if (!/^y(es)?$/i.test((prompt("\nApply? [y/N]") ?? "").trim())) return console.log("Cancelled, nothing written."), 1;
  }
  await applyPolicy(build, { expectedEtag: plan.etag, devHook: opts.devHook });
  console.log(`\n${opts.done}`);
  if (escalate) console.log(`${escalate.replace("escalate:", "Escalate to manager:")}. Change it with: claude-manager policy escalate on|off`);
  return 0;
}
