import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { type Config, isTier, loadConfig, saveConfig, TIERS } from "../config/config.store.ts";
import { reapplyAll } from "../install/install.service.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { PRESET_ROLES } from "../roles/roles.presets.ts";
import { assertRoleName, assertTools, findRole, resolveRoles } from "../roles/roles.registry.ts";
import { roleModel } from "../roles/roles.render.ts";
import type { Command } from "./command.types.ts";

const isPreset = (name: string) => PRESET_ROLES.some((r) => r.name === name);

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

async function save(config: Config, message: string): Promise<number> {
  await saveConfig(config);
  const applied = await reapplyAll(config);
  console.log(`${message}; re-applied ${applied.length} install(s)`);
  return 0;
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
        findRole(config, name);
        if (value === "default") delete config.roleModels[name];
        else if (isTier(value) || /^[\w.\-:\[\]]+$/.test(value)) config.roleModels[name] = value;
        else throw new CliError(`invalid tier or model "${value}"`);
        return save(config, `${name} -> ${value}`);
      }
      case "add": {
        assertRoleName(name);
        if (isPreset(name) || config.customRoles[name]) throw new CliError(`role "${name}" already exists`);
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
        if (tools) assertTools(tools);
        config.customRoles[name] = { tier: values.tier, description: values.description, tools, prompt: values.prompt };
        return save(config, `added ${name}`);
      }
      case "rm": {
        const main = Object.values((await loadManifest()).installs).find((i) => i.mainAgent === name);
        if (main) throw new CliError(`"${name}" is the main agent at ${main.settingsPath}; re-install without --main-agent first`);
        if (config.customRoles[name]) delete config.customRoles[name];
        else if (isPreset(name) && !config.disabledRoles.includes(name)) config.disabledRoles.push(name);
        else throw new CliError(`role "${name}" not found`);
        delete config.roleModels[name];
        return save(config, `removed ${name}`);
      }
      case "enable": {
        if (!config.disabledRoles.includes(name)) throw new CliError(`role "${name}" is not disabled`);
        config.disabledRoles = config.disabledRoles.filter((r) => r !== name);
        return save(config, `enabled ${name}`);
      }
      default:
        throw new CliError(`unknown subcommand "roles ${sub}". Run "claude-manager help roles".`);
    }
  },
};
