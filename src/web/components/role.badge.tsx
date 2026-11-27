import { ToneBadge } from "@/components/tone.badge.tsx";
import { EXT_CLASSES, ROLE_CLASSES, roleColor, type RoleMeta } from "@/lib/color.tokens.ts";
import { CUSTOM_ROLE_ICON, ROLE_ICON } from "@/lib/icon.map.ts";
import { roleKind } from "@/lib/roles.aggregate.ts";

/** Role = icon + name. Presets: tinted fixed hue + own icon; main/subagent: neutral; custom roles: outline + UserRound; external agents: outline + Bot. */
export function RoleBadge({ role, roles }: { role: string; roles?: readonly RoleMeta[] }) {
  const { slot, ext, custom } = roleColor(role, roles);
  const external = custom && roleKind(role, roles) !== "custom";
  const icon = external ? ROLE_ICON.subagent! : custom ? CUSTOM_ROLE_ICON : (Object.hasOwn(ROLE_ICON, role) ? ROLE_ICON[role]! : CUSTOM_ROLE_ICON);
  const hue = ext ? EXT_CLASSES[ext - 1] : slot ? ROLE_CLASSES[slot - 1] : undefined;
  return (
    <ToneBadge hue={hue} icon={icon}>
      {role}
    </ToneBadge>
  );
}
