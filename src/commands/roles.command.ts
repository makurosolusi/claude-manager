import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { applyConfig } from "../config/config.apply.ts";
import { type Config, isTier, loadConfig, TIERS } from "../config/config.store.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { resolveRoles } from "../roles/roles.registry.ts";
import { roleModel } from "../roles/roles.render.ts";
import { addRole, disableRole, enableRole, setRoleModel } from "../roles/roles.service.ts";
import type { ModelChoice } from "../server/agents.types.ts";
import type { Command } from "./command.types.ts";

function list(config: Config): void {
  const roles = resolveRoles(config);
  const width = Math.max(...roles.map((r) => r.name.length));
  for (const r of roles) {
    const model = r.model ? `${r.model} (pinned)` : `${roleModel(r)} -> ${config.tiers[r.tier]}`;
    const tools = r.tools ? r.tools.join(",") : `all except ${r.disallowedTools?.join(",") ?? "-"}`;
    console.log(`${r.name.padEnd(width)}  ${r.tier.padEnd(5)}  ${model.padEnd(32)}  ${r.source.padEnd(6)}  ${tools}`);
  }
  if (config.disabledRoles.length) console.log(`\ndisabled: ${config.disabledRoles.join(", ")}`);
}

async function save(next: Config, message: string): Promise<number> {
  const { applied } = await applyConfig(next);
  console.log(`${message}; re-applied ${applied} install(s)`);
  return 0;
}

function toChoice(value: string): ModelChoice {
  if (value === "default") return { default: true };
  return isTier(value) ? { tier: value } : { pin: value };
}

export const rolesCommand: Command = {
  name: "roles",
  summary: "List, tune, add or remove roles",
  usage: `Usage: claude-manager roles [subcommand]

  roles                                   List roles with tier, model and tools
  roles set <role> <tier|model>           Move a role to a tier (think|work|basic) or pin
                                          a model alias/ID (e.g. fable, claude-sonnet-5-5)
  roles set <role> default                Remove the override
  roles add <name> --tier <t> --description <text> [--tools A,B] [--prompt <text>]
                                          Create a custom role (no --tools = all except Agent)
  roles rm <name>                         Delete a custom role, or disable a preset
  roles enable <name>                     Re-enable a disabled preset

Changes are applied to every scope where claude-manager is installed.

Example:
  claude-manager roles add ui-ux --tier work --tools Read,Grep,Glob,Edit,Write \\
    --description "Designs UI layouts, accessibility and visual polish"`,
  async run(args) {
    const config = await loadConfig();
    const [sub, name, ...rest] = args;
    if (!sub) {
      list(config);
      return 0;
    }
    if (!name) throw new CliError(`missing role name. Run "claude-manager help roles".`);
    switch (sub) {
      case "set": {
        const value = rest[0];
        if (!value) throw new CliError("usage: claude-manager roles set <role> <tier|model>");
        return save(setRoleModel(config, name, toChoice(value)), `${name} -> ${value}`);
      }
      case "add": {
        const { values } = parseArgs({
          args: rest,
          options: {
            tier: { type: "string" },
            description: { type: "string" },
            tools: { type: "string" },
            prompt: { type: "string" },
          },
        });
        if (!values.tier || !isTier(values.tier)) throw new CliError(`--tier is required: ${TIERS.join(", ")}`);
        if (!values.description) throw new CliError("--description is required (Claude uses it to pick the role)");
        const tools = values.tools?.split(",").map((t) => t.trim()).filter(Boolean);
        const input = { name, description: values.description, model: { tier: values.tier }, tools: tools ?? null, prompt: values.prompt };
        return save(addRole(config, input), `added ${name}`);
      }
      case "rm":
        return save(disableRole(config, name, await loadManifest()), `removed ${name}`);
      case "enable":
        return save(enableRole(config, name), `enabled ${name}`);
      default:
        throw new CliError(`unknown subcommand "roles ${sub}". Run "claude-manager help roles".`);
    }
  },
};
