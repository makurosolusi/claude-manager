import { ToneBadge } from "@/components/tone.badge.tsx";
import { EXT_CLASSES, ROLE_CLASSES, roleColor, type RoleMeta } from "@/lib/color.tokens.ts";
import { roleIcon } from "@/lib/role.icon.ts";

/** Role = icon + name. Presets: tinted fixed hue + own icon; main/subagent: neutral; custom roles: outline + UserRound; external agents: outline + Bot. */
export function RoleBadge({ role, roles }: { role: string; roles?: readonly RoleMeta[] }) {
  const { slot, ext } = roleColor(role, roles);
  const hue = ext ? EXT_CLASSES[ext - 1] : slot ? ROLE_CLASSES[slot - 1] : undefined;
  return (
    <ToneBadge hue={hue} icon={roleIcon(role, roles)}>
      {role}
    </ToneBadge>
  );
}
