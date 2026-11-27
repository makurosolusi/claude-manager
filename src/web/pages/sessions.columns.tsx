import type { SessionRow } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { SessionCell } from "@/components/session.cell.tsx";
import { SessionStatusBadge } from "@/components/status.badge.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import { TONE_CLASSES, type RoleMeta } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { cacheHitRate, fmtInt, fmtPct } from "@/lib/format.ts";
import { cacheLevel } from "@/lib/status.level.ts";

/** Role shown for sessions without a named main agent. */
const DEFAULT_ROLE = "main";
const Dash = () => <span className="text-fg-subtle">—</span>;

/** The ten Sessions columns (§5.1); `now` drives status, `roles` the custom-role colours. */
export function sessionColumns(now: number, roles?: readonly RoleMeta[], hrefOf?: (r: SessionRow) => string): Column<SessionRow>[] {
  return [
    { id: "status", header: <span className="sr-only">Status</span>, cell: (r) => <SessionStatusBadge lastTs={r.last_ts} now={now} iconOnly />, width: "w-8", hideBelow: "sm" },
    { id: "session", header: "Session", cell: (r) => <SessionCell id={r.id} title={r.title} projectCwd={r.project_cwd} href={hrefOf?.(r)} lastTs={r.last_ts} now={now} /> },
    { id: "model", header: "Model", cell: (r) => (r.model ? <ModelBadge model={r.model} extra={r.models > 1 ? `+${r.models - 1}` : undefined} /> : <Dash />), width: "w-44", hideBelow: "md" },
    { id: "role", header: "Role", cell: (r) => <RoleBadge role={r.main_agent ?? DEFAULT_ROLE} roles={roles} />, width: "w-32", hideBelow: "lg" },
    { id: "agents", header: "Agents", cell: (r) => (r.agents ? fmtInt(r.agents) : <Dash />), align: "right", sortKey: "agents", width: "w-16", hideBelow: "md" },
    { id: "requests", header: "Requests", cell: (r) => fmtInt(r.requests), align: "right", sortKey: "requests", width: "w-20", hideBelow: "md" },
    { id: "tokens", header: "Tokens", cell: (r) => <TokenCell usage={r} />, align: "right", sortKey: "tokens", width: "w-20", hideBelow: "sm" },
    { id: "cache", header: "Cache", cell: (r) => <span className={cn("tabular-nums", TONE_CLASSES[cacheLevel(cacheHitRate(r))].text)}>{fmtPct(cacheHitRate(r))}</span>, align: "right", width: "w-20", hideBelow: "lg" },
    { id: "cost", header: "Cost (est.)", cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} heat="session" />, align: "right", sortKey: "cost", width: "w-28", hideable: false },
    { id: "last", header: "Last active", cell: (r) => <RelativeTime iso={r.last_ts} />, align: "right", sortKey: "last", width: "w-28", hideBelow: "sm" },
  ];
}
