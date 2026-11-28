import { rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { appDir } from "../app.paths.ts";
import { CliError } from "../cli.error.ts";
import { loadConfig } from "../config/config.store.ts";
import { refreshPolicySnapshot } from "../install/install.service.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { formatOps, resolveTarget } from "../install/install.target.ts";
import { uninstall } from "../install/uninstall.service.ts";
import type { Command } from "./command.types.ts";

export const uninstallCommand: Command = {
  name: "uninstall",
  summary: "Revert everything install wrote",
  usage: `Usage: claude-manager uninstall [options]

Removes the role files and settings keys written by "install". Files or keys
you edited afterwards are kept and reported. Your own agents are never touched.

Options:
  --scope <user|project>  Scope to uninstall (default: user)
  --purge-data            Also delete ${"~/.claude-manager"} (database, config, backups);
                          only allowed when no other scope is still installed
  --dry-run               Show what would change without writing`,
  async run(args) {
    const { values } = parseArgs({
      args,
      options: {
        scope: { type: "string", default: "user" },
        "purge-data": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
    });
    const target = resolveTarget(values.scope!);
    const ops = await uninstall(target, { dryRun: values["dry-run"] });
    // A policy in another scope survives this uninstall; drop this scope's agent files from its snapshot.
    if (!values["dry-run"]) await refreshPolicySnapshot(await loadConfig());
    console.log(values["dry-run"] ? "Dry run, nothing written:" : `Uninstalled (${target.scope} scope):`);
    console.log(formatOps(ops));
    if (values["purge-data"] && !values["dry-run"]) {
      const remaining = Object.keys((await loadManifest()).installs);
      if (remaining.length) {
        throw new CliError(`not purging data: still installed at\n  ${remaining.join("\n  ")}`);
      }
      await rm(appDir(), { recursive: true, force: true });
      console.log(`Deleted ${appDir()}`);
    }
    return 0;
  },
};
