import type { LiveSession } from "../../server/dashboard.types.ts";
import { ContextBar } from "@/components/context.bar.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { SessionCell } from "@/components/session.cell.tsx";
import { SessionStatusBadge } from "@/components/status.badge.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { LEVEL_ICON } from "@/lib/icon.map.ts";
import { levelOf, usedPct } from "@/lib/live.table.ts";
import { LEVEL_TONE } from "@/lib/status.level.ts";

/** Columns the View menu may hide (the Session column always stays). */
export const LIVE_HIDEABLE = [{ id: "status", label: "Status" }, { id: "model", label: "Model" }, { id: "context", label: "Context" }, { id: "last", label: "Last active" }];

/** Context cell: the full bar from sm up; below sm only the % with its level icon and tone. */
function ContextCell({ s }: { s: LiveSession }) {
  const level = levelOf(s);
  const tone = TONE_CLASSES[LEVEL_TONE[level]];
  const Icon = LEVEL_ICON[level];
  return (
    <>
      <span className="block w-64 max-sm:hidden"><ContextBar used={s.context_used} window={s.context_window} size="sm" /></span>
      <span className={cn("inline-flex items-center justify-end gap-1 font-medium sm:hidden", tone.text)}>
        <Icon aria-hidden className="size-3.5" />
        {usedPct(s)}%
      </span>
    </>
  );
}

/** Live sessions table columns; `now` drives the status badge. */
export function liveColumns(now: number): Column<LiveSession>[] {
  return [
    { id: "session", header: "Session", cell: (s) => <SessionCell id={s.id} title={s.title} projectCwd={s.project_cwd} lastTs={s.last_ts} now={now} /> },
    { id: "status", header: "Status", cell: (s) => <SessionStatusBadge lastTs={s.last_ts} now={now} />, width: "w-24", hideBelow: "sm" },
    { id: "model", header: "Model", cell: (s) => <ModelBadge model={s.model} />, width: "w-40", hideBelow: "md" },
    { id: "context", header: "Context used", cell: (s) => <ContextCell s={s} />, align: "right", sortKey: "context", width: "sm:w-80" },
    { id: "cost", header: "Cost (est.)", cell: (s) => <CostCell usd={s.cost_usd} heat="session" />, align: "right", sortKey: "cost", width: "w-24" },
    { id: "last", header: "Last active", cell: (s) => <RelativeTime iso={s.last_ts} />, align: "right", sortKey: "last", width: "w-24", hideBelow: "sm" },
  ];
}
