import pkg from "../package.json" with { type: "json" };
import { CliError, formatError } from "./cli.error.ts";
import type { Command } from "./commands/command.types.ts";

const BIN = "claude-manager";

function renderHelp(commands: Command[]): string {
  const width = Math.max(...commands.map((c) => c.name.length), 4);
  const lines = commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return [
    `${BIN} ${pkg.version} — smart model roles & usage analytics for Claude Code`,
    "",
    `Usage: ${BIN} <command> [options]`,
    "",
    "Commands:",
    ...lines,
    `  ${"help".padEnd(width)}  Show help for a command`,
    "",
    "Global options:",
    "  -h, --help     Show help",
    "  -v, --version  Show version",
  ].join("\n");
}

function findCommand(commands: Command[], name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new CliError(`unknown command "${name}". Run "${BIN} --help".`);
  return command;
}

export async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  // Fast path: the hook runs on every tool call, so it must not load the registry, sqlite, the dashboard or React.
  if (cmd === "hook") return (await import("./commands/hook.command.ts")).runHook(rest);
  const { commands } = await import("./commands/commands.registry.ts");
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(renderHelp(commands));
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(pkg.version);
    return 0;
  }
  if (cmd === "help") {
    console.log(rest[0] ? findCommand(commands, rest[0]).usage : renderHelp(commands));
    return 0;
  }
  const command = findCommand(commands, cmd);
  if (rest.includes("-h") || rest.includes("--help")) {
    console.log(command.usage);
    return 0;
  }
  return command.run(rest);
}

if (import.meta.main) {
  try {
    process.exitCode = await run(Bun.argv.slice(2));
  } catch (err) {
    console.error(formatError(err));
    process.exitCode = err instanceof CliError ? err.exitCode : 1;
  }
}
