import { parseArgs } from "node:util";
import { loadConfig } from "../config/config.store.ts";
import { install } from "../install/install.service.ts";
import { formatOps, resolveTarget } from "../install/install.target.ts";
import type { Command } from "./command.types.ts";

export const installCommand: Command = {
  name: "install",
  summary: "Install role agents + tier models into Claude Code",
  usage: `Usage: claude-manager install [options]

Writes one subagent file per role to <scope>/.claude/agents/ and maps the
opus/sonnet/haiku aliases to your tier models via settings.json "env".
Everything written is recorded so "uninstall" can revert it exactly.

Options:
  --scope <user|project>  user = ~/.claude (default), project = ./.claude
  --main-agent <role>     Also make <role> the main session agent (e.g. manager).
                          Without it, start a swarm with: claude --agent manager
  --force                 Back up and overwrite files not managed by claude-manager
  --dry-run               Show what would change without writing`,
  async run(args) {
    const { values } = parseArgs({
      args,
      options: {
        scope: { type: "string", default: "user" },
        "main-agent": { type: "string" },
        force: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
    });
    const target = resolveTarget(values.scope!);
    const ops = await install(target, await loadConfig(), {
      mainAgent: values["main-agent"],
      force: values.force,
      dryRun: values["dry-run"],
    });
    console.log(values["dry-run"] ? "Dry run, nothing written:" : `Installed (${target.scope} scope):`);
    console.log(formatOps(ops));
    if (!values["dry-run"] && !values["main-agent"]) console.log("\nStart a swarm session with: claude --agent manager");
    return 0;
  },
};
