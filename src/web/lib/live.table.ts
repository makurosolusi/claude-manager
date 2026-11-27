import type { LiveSession } from "../../server/dashboard.types.ts";
import { FAMILIES, SESSION_STATUSES } from "../../server/dashboard.types.ts";
import { CONTEXT_DANGER_PCT, CONTEXT_WARN_PCT, contextLevel, type ContextLevel } from "@/lib/context.level.ts";
import { fmtProject } from "@/lib/format.ts";
import { modelFamily } from "@/lib/model.tier.ts";
import { sessionStatus } from "@/lib/status.level.ts";
import type { ClientTableOptions } from "@/lib/table.client.ts";
import { NO_GROUP, type TableSpec } from "@/lib/table.query.ts";

/** Hash route of the Live page. */
export const LIVE_PATH = "/live";
/** Group values for the Live table. */
export const GROUP_PROJECT = "project";
/** Group id for grouping live sessions by context level. */
export const GROUP_LEVEL = "level";
const LEVELS: readonly ContextLevel[] = ["ok", "warn", "danger"];
const PCT_FULL = 100;

/** Human label per context level, built from the shared thresholds. */
export const LEVEL_LABEL: Record<ContextLevel, string> = {
  ok: `Under ${CONTEXT_WARN_PCT}%`,
  warn: `${CONTEXT_WARN_PCT}–${CONTEXT_DANGER_PCT - 1}%`,
  danger: `${CONTEXT_DANGER_PCT}%+`,
};

/** URL spec of the Live table: default order is fullest context first. */
export const LIVE_SPEC: TableSpec = {
  sorts: ["context", "cost", "last"],
  defaultSort: "context",
  defaultDir: "desc",
  groups: [NO_GROUP, GROUP_PROJECT, GROUP_LEVEL],
  facets: { status: SESSION_STATUSES, level: LEVELS, family: FAMILIES },
};

/** Context used as a rounded percentage of the window (0 when the window is unknown). */
export const usedPct = (s: Pick<LiveSession, "context_used" | "context_window">) => (s.context_window > 0 ? Math.round((s.context_used / s.context_window) * PCT_FULL) : 0);

/** Context severity of a live session (same 70/90 thresholds as the bar). */
export const levelOf = (s: LiveSession): ContextLevel => contextLevel(usedPct(s));

/** Search, facet and sort accessors for live sessions; `now` decides live/idle/ended. */
export function liveTableOptions(now: number): ClientTableOptions<LiveSession> {
  return {
    text: (s) => `${s.title ?? ""} ${s.id} ${fmtProject(s.project_cwd)} ${s.project_cwd ?? ""}`,
    facets: { status: (s) => sessionStatus(s.last_ts, now), level: levelOf, family: (s) => modelFamily(s.model) },
    sort: { context: usedPct, cost: (s) => s.cost_usd, last: (s) => s.last_ts },
  };
}
