import { ToneBadge } from "@/components/tone.badge.tsx";
import { FAMILY_CLASSES } from "@/lib/color.tokens.ts";
import { TIER_ICON } from "@/lib/icon.map.ts";
import { tierFamily, type TierKey, type Tiers } from "@/lib/model.tier.ts";

/** Tier = tier icon + word, coloured by the model family configured for that tier (never a palette of its own). */
export function TierBadge({ tier, tiers }: { tier: TierKey; tiers?: Partial<Tiers> }) {
  return (
    <ToneBadge hue={FAMILY_CLASSES[tierFamily(tier, tiers)]} icon={TIER_ICON[tier]}>
      {tier}
    </ToneBadge>
  );
}
