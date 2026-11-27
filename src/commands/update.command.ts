import { realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import pkg from "../../package.json" with { type: "json" };
import { CliError } from "../cli.error.ts";
import { assetName, compareVersions, fetchLatestTag, installRelease, isCompiledBinary } from "../update/update.service.ts";
import type { Command } from "./command.types.ts";

export const updateCommand: Command = {
  name: "update",
  summary: "Update the claude-manager binary to the latest release",
  usage: `Usage: claude-manager update [--check]

Downloads the latest GitHub release for this OS/arch, verifies its SHA256
checksum and replaces the running binary in place (macOS and Linux).

Options:
  --check  Only report whether a newer release is available`,
  async run(args) {
    const { values } = parseArgs({ args, options: { check: { type: "boolean", default: false } } });
    if (!values.check) {
      if (process.platform === "win32") {
        throw new CliError("self-update is not supported on Windows (experimental build); download the new .exe from the releases page manually");
      }
      if (!isCompiledBinary()) throw new CliError('running from source; update with "git pull" instead');
    }

    const current = pkg.version;
    const tag = await fetchLatestTag();
    const latest = tag.replace(/^v/, "");
    if (compareVersions(tag, current) <= 0) {
      console.log(`up to date (${current})`);
      return 0;
    }
    if (values.check) {
      console.log(`${latest} available (current ${current}); run "claude-manager update"`);
      return 0;
    }
    // realpath so a symlinked install (e.g. ~/.local/bin -> elsewhere) replaces the real file, not the link.
    await installRelease(tag, realpathSync(process.execPath), assetName());
    console.log(`updated ${current} -> ${latest}`);
    return 0;
  },
};
