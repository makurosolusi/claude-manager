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

/** Display name per family, shared by chart, legend and tables. */
export const FAMILY_LABEL: Record<ModelFamily, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", other: "Other" };

/** Chart/dot color per family (CSS var, theme-aware); one mapping so chart, legend and tables agree. */
export const FAMILY_COLOR: Record<ModelFamily, string> = {
  opus: "var(--model-opus)",
  sonnet: "var(--model-sonnet)",
  haiku: "var(--model-haiku)",
  other: "var(--model-other)",
};

/** Family whose colour a tier wears: the family of the model configured for it; "other" for the catch-all tier. */
export const tierFamily = (tier: TierKey, tiers?: Partial<Tiers>): ModelFamily => {
  const model = tier === "other" ? undefined : tiers?.[tier];
  return model ? modelFamily(model) : tier === "think" ? "opus" : tier === "work" ? "sonnet" : tier === "basic" ? "haiku" : "other";
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
