import type { Tier } from "../../config/config.store.ts";

export type { Tier };
/** Model family, detected by substring of the model id. */
export type ModelFamily = "opus" | "sonnet" | "haiku" | "other";
/** Tier a model is billed under on the dashboard; "other" when neither config nor family places it. */
export type TierKey = Tier | "other";
/** Tier → model id map as served by `/api/meta` (`tiers`). */
export type Tiers = Record<Tier, string>;

/** Display order for tier groupings (Cost by tier, Roles). */
export const TIER_ORDER: readonly TierKey[] = ["think", "work", "basic", "other"];

const FAMILY_TIER: Record<Exclude<ModelFamily, "other">, Tier> = { opus: "think", sonnet: "work", haiku: "basic" };

/** Chart/dot color per family; one mapping so chart, legend and tables agree. */
export const FAMILY_COLOR: Record<ModelFamily, string> = {
  opus: "var(--chart-1)",
  sonnet: "var(--chart-2)",
  haiku: "var(--chart-3)",
  other: "var(--chart-4)",
};

/** Lowercased model id without the `[1m]` context suffix or a trailing `-YYYYMMDD` date. */
export const normalizeModel = (id: string) => id.trim().toLowerCase().replace(/\[1m\]$/, "").replace(/-\d{8}$/, "");

/** Family of a model id by substring ("claude-opus-4-7" → "opus"). */
export function modelFamily(model: string): ModelFamily {
  const id = model.toLowerCase();
  for (const f of ["opus", "sonnet", "haiku"] as const) if (id.includes(f)) return f;
  return "other";
}

/** Tier of a model: exact match against configured tier models first, then the family default. */
export function tierOf(model: string, tiers?: Partial<Tiers>): TierKey {
  const id = normalizeModel(model);
  if (tiers) {
    for (const t of ["think", "work", "basic"] as const) {
      const configured = tiers[t];
      if (configured && normalizeModel(configured) === id) return t;
    }
  }
  const f = modelFamily(id);
  return f === "other" ? "other" : FAMILY_TIER[f];
}
