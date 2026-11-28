import type { TierWriteResult } from "../../server/tiers.types.ts";
import { TIER_NEW_SESSIONS_NOTE } from "../../roles/model.ids.ts";
import { appliedText, type WriteFailure } from "./agent.write.ts";
import { ApiWriteError, sendJson } from "./api.write.ts";
import type { Tier } from "./model.tier.ts";

/** Shown under the success notice of a tier change. */
export const TIER_LIVE_NOTE = TIER_NEW_SESSIONS_NOTE;

/** Saves the model behind `tier` (PUT /api/tiers/:tier) guarded by the tiers etag. */
export const saveTier = (tier: Tier, model: string, etag: string): Promise<TierWriteResult> =>
  sendJson<TierWriteResult>("PUT", `/api/tiers/${tier}`, { model }, etag);

/** "work → claude-sonnet-5-6 · applied to 2 installs." (0 installs adds where it was written). */
export const tierSavedText = (r: Pick<TierWriteResult, "tier" | "model" | "applied">): string =>
  `${appliedText(`${r.tier} →`, r.model, r.applied)}${r.applied === 0 ? " Written on claude-manager install." : ""}`;

/** Editor banner for a failed save: 412 offers Reload, everything else shows the server message (400 = model rejected). */
export function tierFailure(err: unknown): WriteFailure {
  if (!(err instanceof ApiWriteError)) return { field: null, text: err instanceof Error ? err.message : String(err), reload: false };
  if (err.status === 412) return { field: null, text: `The tier settings changed since you opened this (${err.serverMessage}). Reload to see the current model.`, reload: true };
  return { field: null, text: err.serverMessage, reload: false };
}
