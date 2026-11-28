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

function printPlan(plan: PolicyPlan): void {
  console.log(`settings: ${plan.settingsPath ?? "-"}`);
  if (!plan.changes.length) console.log("  (no settings changes)");
  for (const c of plan.changes) {
    const sign = { add: "+", remove: "-", keep: "=", set: "~" }[c.op];
    const value = typeof c.value === "string" ? c.value : JSON.stringify(c.value);
    console.log(`  ${sign} ${c.path === plan.settingsPath ? "" : `${c.path}: `}${c.list ?? "key"}: ${value}`);
  }
  console.log(plan.hook ? `hook: PreToolUse ${plan.hook.matcher}` : "hook: none");
  console.log(plan.snapshot ? `snapshot: ${plan.compiledPath}` : `snapshot: removed (${plan.compiledPath})`);
  if (plan.snapshot) console.log(`\n${matrixTable(plan.rows)}`);
}

/** Preview, optionally confirm, then write through the shared `applyPolicy` path (same as the dashboard API). */
export async function runPolicyChange(
  build: ConfigBuild,
  opts: { dryRun: boolean; confirm: boolean; yes: boolean; done: string },
): Promise<number> {
  const plan = await previewPolicy(await build(await loadConfig(), await loadManifest()));
  printPlan(plan);
  if (opts.dryRun) {
    console.log("\nDry run, nothing written.");
    return 0;
  }
  if (opts.confirm && !opts.yes) {
    if (!process.stdin.isTTY) throw new CliError("not a terminal: pass --yes to apply without the prompt");
    if (!/^y(es)?$/i.test((prompt("\nApply? [y/N]") ?? "").trim())) return console.log("Cancelled, nothing written."), 1;
  }
  await applyPolicy(build, { expectedEtag: plan.etag });
  console.log(`\n${opts.done}`);
  return 0;
}
