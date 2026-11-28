import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { applyConfig } from "../config/config.apply.ts";
import type { Tier } from "../config/config.store.ts";
import { updateRole } from "../roles/roles.service.ts";
import type { AgentPatch } from "../server/agents.types.ts";

export const EDIT_USAGE = `usage: claude-manager roles edit <name> [flags]
  --description <text>   "When to use" text
  --tier <think|work|basic> | --pin <model> | --default   (choose one) model routing
  --tools <A,B,...|all>  Tool allowlist; "all" = all except Agent
  --prompt-file <path>   System prompt from a file (empty file = default prompt)
  --enable | --disable   Presets only`;

async function readPrompt(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new CliError(`--prompt-file: cannot read "${path}" (file not found)`);
  return file.text();
}

/** Builds the same AgentPatch that PATCH /api/agents/:name receives. */
async function buildPatch(rest: string[]): Promise<AgentPatch> {
  const { values: v } = parseArgs({
    args: rest,
    options: {
      description: { type: "string" },
      tier: { type: "string" },
      pin: { type: "string" },
      default: { type: "boolean" },
      tools: { type: "string" },
      "prompt-file": { type: "string" },
      enable: { type: "boolean" },
      disable: { type: "boolean" },
    },
  });
  if ([v.tier, v.pin, v.default].filter((x) => x !== undefined).length > 1) throw new CliError("--tier, --pin and --default are mutually exclusive");
  if (v.enable && v.disable) throw new CliError("--enable and --disable are mutually exclusive");
  const patch: AgentPatch = {};
  if (v.description !== undefined) patch.description = v.description;
  if (v.tier !== undefined) patch.model = { tier: v.tier as Tier }; // the service validates the tier
  if (v.pin !== undefined) patch.model = { pin: v.pin };
  if (v.default) patch.model = { default: true };
  if (v.tools !== undefined) patch.tools = v.tools.trim() === "all" ? null : v.tools.split(",").map((t) => t.trim()).filter(Boolean);
  if (v["prompt-file"] !== undefined) patch.prompt = await readPrompt(v["prompt-file"]);
  if (v.enable) patch.enabled = true;
  if (v.disable) patch.enabled = false;
  return patch;
}

/** `roles edit <name> [flags]`: same service path as the PATCH handler; writes only when the config changed. */
export async function editRole(name: string, rest: string[]): Promise<number> {
  const patch = await buildPatch(rest);
  if (Object.keys(patch).length === 0) throw new CliError(EDIT_USAGE);
  const { applied } = await applyConfig((c, m) => updateRole(c, name, patch, m), { skipUnchanged: true });
  console.log(`updated ${name}; re-applied ${applied} install(s)`);
  return 0;
}
