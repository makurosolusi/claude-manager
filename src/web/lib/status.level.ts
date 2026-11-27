import { contextLevel, type ContextLevel } from "./context.level.ts";
import type { ToneKey } from "./color.tokens.ts";
import { SESSION_STATUS_MIN } from "../../server/dashboard.types.ts";

export type SessionStatus = "live" | "idle" | "ended";

const MINUTE_MS = 60_000;
/** Cache-hit ratio at or above which caching is good (success). */
export const CACHE_GOOD = 0.8;
/** Cache-hit ratio at or above which caching is poor-but-present (warning); below is danger. */
export const CACHE_POOR = 0.5;

/** Session status from its last activity: live ≤ 5 min, idle ≤ 15 min, else ended. Missing/invalid timestamp → ended. */
export function sessionStatus(lastTs: string | null | undefined, now: number): SessionStatus {
  const t = lastTs ? Date.parse(lastTs) : NaN;
  if (Number.isNaN(t)) return "ended";
  const ageMin = (now - t) / MINUTE_MS;
  return ageMin <= SESSION_STATUS_MIN.live ? "live" : ageMin <= SESSION_STATUS_MIN.idle ? "idle" : "ended";
}

/** Tone per session status. */
export const STATUS_TONE: Record<SessionStatus, ToneKey> = { live: "success", idle: "warning", ended: "neutral" };
/** Tone per context level. */
export const LEVEL_TONE: Record<ContextLevel, ToneKey> = { ok: "success", warn: "warning", danger: "danger" };
/** Tone for a context percentage (reuses the 70/90 thresholds of `contextLevel`). */
export const contextTone = (pct: number): ToneKey => LEVEL_TONE[contextLevel(pct)];

/** Tone for a cache-hit ratio (0..1): ≥0.80 success, ≥0.50 warning, else danger. */
export const cacheLevel = (ratio: number): ToneKey => (ratio >= CACHE_GOOD ? "success" : ratio >= CACHE_POOR ? "warning" : "danger");

/** Tone per stop reason; unlisted reasons are neutral. */
export const STOP_TONE: Record<string, ToneKey> = {
  end_turn: "neutral", tool_use: "info", max_tokens: "warning", refusal: "danger", stop_sequence: "neutral", pause_turn: "neutral",
};
/** Tone for a stop reason (null/unknown → neutral). */
export const stopTone = (reason: string | null): ToneKey => (reason && Object.hasOwn(STOP_TONE, reason) ? STOP_TONE[reason]! : "neutral");
