import { CliError } from "../cli.error.ts";
import { type Config, isTier } from "../config/config.store.ts";
import { KNOWN_TOOLS, PRESET_ROLES, type Role } from "./roles.presets.ts";

const ROLE_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Throws a 400 CliError unless `name` is a string role name; names on Object.prototype ("constructor") are reserved. */
export function assertRoleName(name: unknown): asserts name is string {
  if (typeof name !== "string") throw new CliError("name is required");
  if (!ROLE_NAME.test(name)) {
    throw new CliError(`invalid role name "${name}": use lowercase letters, digits and dashes`);
  }
  if (Object.hasOwn(Object.prototype, name)) throw new CliError(`invalid role name "${name}": reserved`);
}

/** `map[key]` only when `key` is an own property, so "__proto__"/"constructor" never resolve to Object.prototype. */
export const ownValue = <T>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

export function assertTools(tools: string[]): void {
  for (const tool of tools) {
    const base = tool.replace(/\(.*\)$/, "");
    if (!KNOWN_TOOLS.includes(base) && !base.startsWith("mcp__")) {
      throw new CliError(`unknown tool "${tool}". Known: ${KNOWN_TOOLS.join(", ")} (or mcp__*)`);
    }
  }
}

/** Claude Code's built-in subagents (docs verified 2026-11-27); listed read-only on the Agents page. */
export const BUILTIN_AGENTS = ["Explore", "Plan", "general-purpose", "claude", "statusline-setup", "claude-code-guide", "web-fetch"];

export type RoleEntry = Role & { disabled: boolean };

/** Presets + custom roles with config overrides applied; disabled roles are included and flagged. */
export function allRoles(config: Config): RoleEntry[] {
  const custom: Role[] = Object.entries(config.customRoles).map(([name, r]) => ({
    name,
    tier: r.tier,
    description: r.description,
    tools: r.tools,
    disallowedTools: r.tools ? undefined : ["Agent"],
    prompt: r.prompt ?? `You are the ${name} specialist. ${r.description}`,
    source: "custom",
  }));
  return [...PRESET_ROLES, ...custom].map((role) => {
    const override = ownValue(config.roleModels, role.name);
    const disabled = config.disabledRoles.includes(role.name);
    if (!override) return { ...role, disabled };
    return isTier(override) ? { ...role, tier: override, disabled } : { ...role, model: override, disabled };
  });
}

/** Presets + custom roles with config overrides applied; disabled roles excluded. */
export function resolveRoles(config: Config): Role[] {
  return allRoles(config)
    .filter((role) => !role.disabled)
    .map(({ disabled: _disabled, ...role }) => role);
}

export function findRole(config: Config, name: string): Role {
  const role = resolveRoles(config).find((r) => r.name === name);
  if (!role) throw new CliError(`role "${name}" not found. Run "claude-manager roles".`);
  return role;
}
