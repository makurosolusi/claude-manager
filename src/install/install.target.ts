import { join } from "node:path";
import { claudeDir } from "../app.paths.ts";
import { CliError } from "../cli.error.ts";
import type { Scope } from "./install.manifest.ts";

export interface Target {
  scope: Scope;
  agentsDir: string;
  settingsPath: string;
}

export type FileOp = {
  path: string;
  op: "create" | "update" | "unchanged" | "conflict" | "remove" | "restore" | "keep-modified";
};

export function resolveTarget(scope: string, cwd = process.cwd()): Target {
  if (scope !== "user" && scope !== "project") {
    throw new CliError(`invalid --scope "${scope}": use "user" or "project"`);
  }
  const dir = scope === "user" ? claudeDir() : join(cwd, ".claude");
  return { scope, agentsDir: join(dir, "agents"), settingsPath: join(dir, "settings.json") };
}

export function formatOps(ops: FileOp[]): string {
  const home = process.env.HOME;
  return ops
    .map(({ op, path }) => `  ${op.padEnd(13)} ${home && path.startsWith(home) ? `~${path.slice(home.length)}` : path}`)
    .join("\n");
}

export async function readText(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
}

export function parseSettings(raw: string | undefined, path: string): Record<string, unknown> {
  if (raw === undefined || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch (err) {
    throw new CliError(`cannot parse ${path} (Claude Code requires strict JSON): ${(err as Error).message}`);
  }
  throw new CliError(`${path} must contain a JSON object`);
}
