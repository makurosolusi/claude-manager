import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { isPresetName, PRESET_NAMES } from "../policy/policy.presets.ts";
import { applyPreset, disablePolicy, enablePolicy, setCell } from "../policy/policy.service.ts";
import type { Command } from "./command.types.ts";
import { auditPolicy } from "./policy.command.audit.ts";
import { DEV_HOOK_OPTION, gitRoot, runPolicyChange } from "./policy.command.apply.ts";
import { showPolicy } from "./policy.command.show.ts";

const USAGE = `Usage: claude-manager policy <subcommand>

  policy show [--json]                 Status, target settings file, hook state and the matrix
  policy apply <${PRESET_NAMES.join("|")}> [--scope user|project] [--accept-edits] [--dry-run] [--yes] [--dev-hook]
                                       Write the preset (resets overrides). Prompts on a terminal;
                                       without a terminal --yes is required.
                                       --dev-hook: development only, allow a hook that runs from a source checkout
  policy set <row> <capability> <allow|ask|deny|default>
                                       Override one matrix cell (push can never be allow)
  policy enable | disable [--dry-run]  Turn the stored policy on or off (disable reverts settings)
  policy audit [--since 7d] [--role <r>] [--decision <d>] [--limit 20]
                                       Recent hook decisions

Scope: user = ~/.claude/settings.json (default), project = <git root>/.claude/settings.local.json.`;

const opts = (args: string[], options: Record<string, { type: "string" | "boolean"; default?: string | boolean }>, positionals = true) =>
  parseArgs({ args, options, allowPositionals: positionals });

export const policyCommand: Command = {
  name: "policy",
  summary: "Per-role permission policy (hook, settings rules, audit)",
  usage: USAGE,
  async run(args) {
    const [sub, ...rest] = args;
    const flags = { "dry-run": { type: "boolean", default: false }, yes: { type: "boolean", default: false } } as const;
    switch (sub) {
      case "show":
        return showPolicy(opts(rest, { json: { type: "boolean", default: false } }, false).values.json as boolean);
      case "apply": {
        const { values: v, positionals: [preset, extra] } = opts(rest, {
          ...flags, scope: { type: "string", default: "user" }, "accept-edits": { type: "boolean", default: false }, ...DEV_HOOK_OPTION,
        });
        if (!isPresetName(preset) || extra) throw new CliError(`usage: claude-manager policy apply <${PRESET_NAMES.join("|")}> [options]`);
        if (v.scope !== "user" && v.scope !== "project") throw new CliError(`invalid --scope "${v.scope}": use user or project`);
        const projectDir = v.scope === "project" ? gitRoot() : undefined;
        const defaultMode = v["accept-edits"] ? ("acceptEdits" as const) : undefined;
        return runPolicyChange((c) => applyPreset(c, preset, v.scope as "user" | "project", { projectDir, defaultMode }), {
          dryRun: v["dry-run"] as boolean, yes: v.yes as boolean, confirm: true, devHook: v["dev-hook"] as boolean, done: `Applied ${preset} policy (${v.scope} scope).`,
        });
      }
      case "set": {
        const [row, cap, decision, ...more] = opts(rest, {}).positionals;
        if (!row || !cap || !decision || more.length) throw new CliError("usage: claude-manager policy set <row> <capability> <allow|ask|deny|default>");
        return runPolicyChange((c) => setCell(c, row, cap, decision), { dryRun: false, yes: true, confirm: false, done: `Set ${row}.${cap} = ${decision}.` });
      }
      case "enable":
      case "disable": {
        const { values: v } = opts(rest, { "dry-run": flags["dry-run"] }, false);
        const on = sub === "enable";
        return runPolicyChange(on ? enablePolicy : disablePolicy, {
          dryRun: v["dry-run"] as boolean, yes: true, confirm: false, done: on ? "Policy enabled." : "Policy disabled; settings reverted.",
        });
      }
      case "audit": {
        const { values: v } = opts(rest, {
          since: { type: "string", default: "7d" }, role: { type: "string" }, decision: { type: "string" }, limit: { type: "string", default: "20" },
        }, false);
        return auditPolicy({ since: v.since as string, role: v.role as string | undefined, decision: v.decision as string | undefined, limit: v.limit as string });
      }
      default:
        throw new CliError(sub ? `unknown policy subcommand "${sub}"\n${USAGE}` : USAGE);
    }
  },
};
