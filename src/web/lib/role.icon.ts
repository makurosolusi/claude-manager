import type { LucideIcon } from "lucide-react";
import { roleColor, type RoleMeta } from "./color.tokens.ts";
import { CUSTOM_ROLE_ICON, ROLE_ICON } from "./icon.map.ts";
import { roleKind } from "./roles.aggregate.ts";

/** Icon of a role: its own for presets, UserRound for custom roles, Bot for external agents and any other role missing from the roster. */
export function roleIcon(role: string, roles?: readonly RoleMeta[]): LucideIcon {
  if (!roleColor(role, roles).custom) return Object.hasOwn(ROLE_ICON, role) ? ROLE_ICON[role]! : CUSTOM_ROLE_ICON;
  return roleKind(role, roles) === "custom" ? CUSTOM_ROLE_ICON : ROLE_ICON.subagent!;
}
