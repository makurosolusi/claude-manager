import { ToneBadge } from "@/components/tone.badge.tsx";
import { ROLE_CLASSES, roleColor, type RoleMeta } from "@/lib/color.tokens.ts";
import { CUSTOM_ROLE_ICON, ROLE_ICON } from "@/lib/icon.map.ts";

/** Role = icon + name. Presets keep a fixed hue + icon; main/subagent are neutral; other names get a hashed hue, dashed border and UserRound. */
export function RoleBadge({ role, roles }: { role: string; roles?: readonly RoleMeta[] }) {
  const { slot, custom } = roleColor(role, roles);
  const icon = !custom && Object.hasOwn(ROLE_ICON, role) ? ROLE_ICON[role]! : CUSTOM_ROLE_ICON;
  return (
    <ToneBadge hue={slot ? ROLE_CLASSES[slot - 1] : undefined} icon={icon} dashed={custom}>
      {role}
    </ToneBadge>
  );
}
