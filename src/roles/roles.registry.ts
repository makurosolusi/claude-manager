import { CliError } from "../cli.error.ts";
import { type Config, isTier } from "../config/config.store.ts";
import { KNOWN_TOOLS, PRESET_ROLES, type Role } from "./roles.presets.ts";

const ROLE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function assertRoleName(name: string): void {
  if (!ROLE_NAME.test(name)) {
    throw new CliError(`invalid role name "${name}": use lowercase letters, digits and dashes`);
  }
}

export function assertTools(tools: string[]): void {
  for (const tool of tools) {
    const base = tool.replace(/\(.*\)$/, "");
    if (!KNOWN_TOOLS.includes(base) && !base.startsWith("mcp__")) {
      throw new CliError(`unknown tool "${tool}". Known: ${KNOWN_TOOLS.join(", ")} (or mcp__*)`);
    }
  }
}

/** Presets + custom roles with config overrides applied; disabled roles excluded. */
export function resolveRoles(config: Config): Role[] {
  const custom: Role[] = Object.entries(config.customRoles).map(([name, r]) => ({
    name,
    tier: r.tier,
    description: r.description,
    tools: r.tools,
    disallowedTools: r.tools ? undefined : ["Agent"],
    prompt: r.prompt ?? `You are the ${name} specialist. ${r.description}`,
    source: "custom",
  }));
  return [...PRESET_ROLES, ...custom]
    .filter((role) => !config.disabledRoles.includes(role.name))
    .map((role) => {
      const override = config.roleModels[role.name];
      if (!override) return role;
      return isTier(override) ? { ...role, tier: override } : { ...role, model: override };
    });
}

export function findRole(config: Config, name: string): Role {
  const role = resolveRoles(config).find((r) => r.name === name);
  if (!role) throw new CliError(`role "${name}" not found. Run "claude-manager roles".`);
  return role;
}
