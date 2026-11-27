/** Context usage (percent) at which a session is flagged as getting full. */
export const CONTEXT_WARN_PCT = 70;
/** Context usage (percent) at which a session is about to run out. */
export const CONTEXT_DANGER_PCT = 90;

export type ContextLevel = "ok" | "warn" | "danger";

/** Severity for a used-context percentage. */
export const contextLevel = (pct: number): ContextLevel => (pct >= CONTEXT_DANGER_PCT ? "danger" : pct >= CONTEXT_WARN_PCT ? "warn" : "ok");
