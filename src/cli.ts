import pkg from "../package.json" with { type: "json" };
import { CliError, formatError } from "./cli.error.ts";
import { commands } from "./commands/commands.registry.ts";

const BIN = "claude-manager";

function renderHelp(): string {
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

function findCommand(name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new CliError(`unknown command "${name}". Run "${BIN} --help".`);
  return command;
}

export async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(renderHelp());
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(pkg.version);
    return 0;
  }
  if (cmd === "help") {
    console.log(rest[0] ? findCommand(rest[0]).usage : renderHelp());
    return 0;
  }
  const command = findCommand(cmd);
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
