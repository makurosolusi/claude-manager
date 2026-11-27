import { useState, type ReactNode } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import { TriangleAlert } from "lucide-react";
import { ModelDot } from "@/components/model.badge.tsx";
import { NAV_ICON, KPI_ICON } from "@/lib/icon.map.ts";
import { cacheLevel } from "@/lib/status.level.ts";
import type { Overview, Page, ProjectRow, SessionRow, Totals } from "../../server/dashboard.types.ts";
import { Button } from "@/components/ui/button.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { KpiCard, type KpiDelta } from "@/components/kpi.card.tsx";
import { DataTable, type Column } from "@/components/data.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { SessionCell } from "@/components/session.cell.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { CostChart, CostLegend, pivotCostByDay } from "@/components/cost.chart.tsx";
import { TierTable } from "@/components/tier.table.tsx";
import { useApi } from "@/lib/api.client.ts";
import { cacheHitRate, fmtDelta, fmtInt, fmtPct, fmtProject, fmtUsd } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { DEFAULT_RANGE, type Range } from "@/lib/range.ts";
import { costByTier } from "@/lib/tier.cost.ts";

/** Rows in the Top projects / Top sessions lists. */
export const TOP_N = 5;
const PERIOD_TEXT: Record<Range, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

type Kpis = Record<"cost" | "requests" | "sessions" | "cacheHit", number | null>;
/** Change vs the previous period per KPI: % for cost/requests/sessions, percentage points for cache hit; null without a baseline. */
export function overviewDeltas(cur: Totals, prev: Totals | null): Kpis | null {
  if (!prev) return null;
  const hasPrompt = prev.input + prev.cache_read + prev.cache_write > 0;
  return {
    cost: fmtDelta(cur.cost_usd, prev.cost_usd),
    requests: fmtDelta(cur.requests, prev.requests),
    sessions: fmtDelta(cur.sessions, prev.sessions),
    cacheHit: hasPrompt ? (cacheHitRate(cur) - cacheHitRate(prev)) * 100 : null,
  };
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-[13px] font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const ViewAll = ({ href }: { href: string }) => (
  <a href={href} className="rounded-sm text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">View all →</a>
);
const Skeleton = ({ className }: { className: string }) => <div aria-hidden className={`animate-pulse rounded-sm bg-muted ${className}`} />;

/** Overview dashboard: 4 KPIs with deltas, stacked daily cost by model family, top projects/sessions, cost by tier. */
export function OverviewPage({ since, range, dataVersion, tiers }: PageProps) {
  const [retry, setRetry] = useState(0);
  const tick = dataVersion + retry;
  const onRetry = () => setRetry((n) => n + 1);
  const ov = useApi<Overview>("/api/overview", { since }, tick);
  const projects = useApi<Page<ProjectRow>>("/api/projects", { since, pageSize: TOP_N }, tick);
  const sessions = useApi<Page<SessionRow>>("/api/sessions", { since, sort: "cost", dir: "desc", pageSize: TOP_N }, tick);
  const rangeParam = range === DEFAULT_RANGE ? undefined : range;
  const header = <PageHeader icon={NAV_ICON.overview} title="Overview" description={range === "all" ? PERIOD_TEXT.all : `${PERIOD_TEXT[range]} · all projects`} />;

  if (ov.error && !ov.data) {
    return (
      <>
        {header}
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-[13px]">
          <TriangleAlert aria-hidden className="size-4 text-destructive" />
          <span className="font-medium text-foreground">Couldn't load overview.</span>
          <span className="min-w-0 break-words text-muted-foreground">{ov.error.message}</span>
          <Button size="xs" variant="outline" onClick={onRetry}>Retry</Button>
        </div>
      </>
    );
  }
  const d = ov.data;
  if (d && d.total.requests === 0) {
    return (
      <>
        {header}
        <p className="rounded-lg border bg-card p-12 text-center text-[13px] text-muted-foreground">No usage in this range. Try a wider range.</p>
      </>
    );
  }

  const deltas = d ? overviewDeltas(d.total, d.prev) : null;
  const delta = (value: number | null | undefined, unit: KpiDelta["unit"]): KpiDelta | undefined =>
    deltas && value !== undefined ? { value, unit, periodLabel: range } : undefined;
  const kpi = (value: ReactNode) => (d ? value : <Skeleton className="h-7 w-24" />);
  const today = new Date().toISOString().slice(0, 10);
  const startDay = range === "all" ? (d?.byDayModel.reduce((m, r) => (r.day < m ? r.day : m), today) ?? today) : since.slice(0, 10);
  const chart = d ? pivotCostByDay(d.byDayModel, startDay, today) : undefined;
  const totalCost = d?.total.cost_usd ?? 0;

  const projectCols: Column<ProjectRow>[] = [
    { id: "project", header: "Project", cell: (r) => <span className="font-mono text-xs" title={r.project}>{fmtProject(r.project)}</span> },
    { id: "cost", header: "Cost (est.)", align: "right", width: "w-24", cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} /> },
    {
      id: "share", header: <span className="sr-only">Share</span>, width: "w-20",
      cell: (r) => (
        <span aria-hidden className="block h-1.5 w-16 overflow-hidden rounded-full bg-muted" title={totalCost ? fmtPct(r.cost_usd / totalCost) : undefined}>
          <span className="block h-full rounded-full bg-foreground/50" style={{ width: `${totalCost ? (r.cost_usd / totalCost) * 100 : 0}%` }} />
        </span>
      ),
    },
  ];
  const sessionCols: Column<SessionRow>[] = [
    { id: "session", header: "Session", cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.model && <ModelDot model={r.model} />}
          <span className="min-w-0 flex-1"><SessionCell id={r.id} title={r.title} projectCwd={r.project_cwd} /></span>
        </span>
      ),
    },
    { id: "cost", header: "Cost (est.)", align: "right", width: "w-24", cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} /> },
    { id: "last", header: "Last active", align: "right", width: "w-24", hideBelow: "sm", cell: (r) => <RelativeTime iso={r.last_ts} /> },
  ];

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={KPI_ICON.cost} label="Est. cost" value={kpi(fmtUsd(totalCost))} delta={delta(deltas?.cost, "pct")} hint={d?.total.unpriced ? `${fmtInt(d.total.unpriced)} requests unpriced` : undefined} />
        <KpiCard icon={KPI_ICON.requests} label="Requests" value={kpi(fmtInt(d?.total.requests ?? 0))} delta={delta(deltas?.requests, "pct")} />
        <KpiCard icon={KPI_ICON.sessions} label="Sessions" value={kpi(fmtInt(d?.total.sessions ?? 0))} delta={delta(deltas?.sessions, "pct")} />
        <KpiCard icon={KPI_ICON.cache} tone={d ? cacheLevel(cacheHitRate(d.total)) : undefined} label="Cache hit rate" value={kpi(d ? fmtPct(cacheHitRate(d.total)) : "")} delta={delta(deltas?.cacheHit, "pt")} />
      </div>
      <Panel title="Cost per day (est.)" action={chart && <CostLegend series={chart.series} />}>
        {chart ? <CostChart series={chart.series} points={chart.points} models={chart.models} /> : <Skeleton className="h-56 w-full" />}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Top projects" action={<ViewAll href={hashHref("/projects", { range: rangeParam })} />}>
          <DataTable label="Top projects" rows={projects.data?.items} columns={projectCols} rowKey={(r) => r.project} rowHref={(r) => hashHref("/sessions", { project: r.project, range: rangeParam })} loading={projects.loading} error={projects.error} onRetry={onRetry} skeletonRows={TOP_N} />
        </Panel>
        <Panel title="Top sessions" action={<ViewAll href={hashHref("/sessions", { sort: "cost", dir: "desc", range: rangeParam })} />}>
          <DataTable label="Top sessions" rows={sessions.data?.items} columns={sessionCols} rowKey={(r) => r.id} rowHref={(r) => `#/sessions/${r.id}`} loading={sessions.loading} error={sessions.error} onRetry={onRetry} skeletonRows={TOP_N} />
        </Panel>
      </div>
      <Panel title="Cost by tier">
        <TierTable rows={d ? costByTier(d.byModel, tiers) : undefined} tiers={tiers} loading={ov.loading} />
      </Panel>
    </>
  );
}
