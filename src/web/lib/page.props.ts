import type { RoleMeta } from "@/lib/color.tokens.ts";
import type { Tiers } from "@/lib/model.tier.ts";
import type { Range } from "@/lib/range.ts";

/** Props the shell passes to every page (contract §8); pages ignore the ones they do not need. */
export interface PageProps {
  since: string;
  range: Range;
  dataVersion: number;
  params: URLSearchParams;
  tiers?: Tiers;
  roles?: readonly RoleMeta[];
}
