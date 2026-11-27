import { FolderOpen } from "lucide-react";
import type { ProjectRow } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { ShareBar } from "@/components/share.bar.tsx";
import { SessionStatusBadge } from "@/components/status.badge.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { cacheHitRate, fmtInt, fmtPct, fmtProject } from "@/lib/format.ts";
import { CACHE_GOOD, CACHE_POOR, cacheLevel } from "@/lib/status.level.ts";

/** Columns the View menu may hide (the Project column always stays). */
export const PROJECT_HIDEABLE = [
  { id: "status", label: "Status" }, { id: "sessions", label: "Sessions" }, { id: "requests", label: "Requests" }, { id: "tokens", label: "Tokens" },
  { id: "cache", label: "Cache hit" }, { id: "share", label: "Share" }, { id: "last", label: "Last active" },
];
const CACHE_TIP = `Cache hit: ${CACHE_GOOD * 100}%+ good, ${CACHE_POOR * 100}%+ fair, below that poor`;

/** Cache-hit ratio as tone-coloured text (the number is the second cue). */
export function CacheText({ ratio }: { ratio: number }) {
  return <span title={CACHE_TIP} className={cn("tabular-nums", TONE_CLASSES[cacheLevel(ratio)].text)}>{fmtPct(ratio)}</span>;
}

/** Projects table columns; `totalCost` is the cost sum of every loaded project (denominator of Share) and `now` drives status. */
export function projectColumns(totalCost: number, now: number): Column<ProjectRow>[] {
  return [
    {
      id: "project",
      header: "Project",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2" title={r.project}>
          <FolderOpen aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs">{fmtProject(r.project)}</span>
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (r) => <SessionStatusBadge lastTs={r.last_ts} now={now} />, width: "w-24", hideBelow: "sm" },
    { id: "sessions", header: "Sessions", cell: (r) => fmtInt(r.sessions), align: "right", sortKey: "sessions", width: "w-20", hideBelow: "sm" },
    { id: "requests", header: "Requests", cell: (r) => fmtInt(r.requests), align: "right", sortKey: "requests", width: "w-24", hideBelow: "md" },
    { id: "tokens", header: "Tokens", cell: (r) => <TokenCell usage={r} />, align: "right", sortKey: "tokens", width: "w-20", hideBelow: "sm" },
    { id: "cache", header: "Cache hit", cell: (r) => <CacheText ratio={cacheHitRate(r)} />, align: "right", width: "w-20", hideBelow: "lg" },
    { id: "cost", header: "Cost (est.)", cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} />, align: "right", sortKey: "cost", width: "w-28" },
    {
      id: "share",
      header: "Share",
      cell: (r) => <ShareBar share={totalCost > 0 ? r.cost_usd / totalCost : 0} />,
      align: "right",
      width: "w-36",
      hideBelow: "md",
    },
    { id: "last", header: "Last active", cell: (r) => <RelativeTime iso={r.last_ts} />, align: "right", sortKey: "last", width: "w-24" },
  ];
}
