import { TIER_ALIAS } from "../config/config.store.ts";
import { ROSTER_PLACEHOLDER, type Role } from "./roles.presets.ts";

export const roleModel = (role: Role) => role.model ?? TIER_ALIAS[role.tier];

function renderRoster(roles: Role[], self: Role): string {
  return roles
    .filter((r) => r.name !== self.name)
    .map((r) => `- **${r.name}** (model: ${roleModel(r)}): ${r.description}`)
    .join("\n");
}

/** Renders a Claude Code subagent file (.claude/agents/<name>.md). */
export function renderRole(role: Role, roster: Role[]): string {
  const lines = [
    "---",
    `name: ${role.name}`,
    // JSON strings are valid YAML double-quoted scalars, so colons/quotes stay safe.
    `description: ${JSON.stringify(role.description)}`,
    `model: ${roleModel(role)}`,
  ];
  if (role.tools) lines.push(`tools: ${role.tools.join(", ")}`);
  if (role.disallowedTools) lines.push(`disallowedTools: ${role.disallowedTools.join(", ")}`);
  if (role.color) lines.push(`color: ${role.color}`);
  lines.push("---", "");
  const prompt = role.prompt.replace(ROSTER_PLACEHOLDER, renderRoster(roster, role));
  return `${lines.join("\n")}${prompt}\n`;
}
