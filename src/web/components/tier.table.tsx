import { DataTable, type Column } from "@/components/data.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { cacheHitRate, fmtInt, fmtModel, fmtPct, fmtUsd } from "@/lib/format.ts";
import { FAMILY_COLOR, modelFamily, type Tiers } from "@/lib/model.tier.ts";
import type { TierModelRow, TierRow } from "@/lib/tier.cost.ts";
import { cn } from "@/lib/cn.ts";

/** Flattened row: a tier header or one of its model sub-rows. */
type Row = { kind: "tier"; tier: TierRow } | { kind: "model"; tier: TierRow; model: TierModelRow };
const sums = (r: Row) => (r.kind === "tier" ? r.tier : r.model);

function TierLabel({ row, tiers }: { row: TierRow; tiers: Tiers | undefined }) {
  const configured = row.tier !== "other" ? tiers?.[row.tier] : undefined;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="font-medium text-foreground">{row.tier}</span>
      {configured && <span className="truncate font-mono text-xs text-fg-subtle">{fmtModel(configured)}</span>}
    </span>
  );
}

function ModelLabel({ model }: { model: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 pl-4">
      <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: FAMILY_COLOR[modelFamily(model)] }} />
      <span className="truncate font-mono text-xs text-fg-subtle" title={model}>{fmtModel(model)}</span>
    </span>
  );
}

function ShareBar({ share, dim }: { share: number; dim?: boolean }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", dim ? "bg-brand/40" : "bg-brand/70")} style={{ width: `${share * 100}%` }} />
      </span>
      <span className={cn("w-12 tabular-nums", dim && "text-fg-subtle")}>{fmtPct(share)}</span>
    </span>
  );
}

const sub = (r: Row) => r.kind === "model" && "text-xs text-fg-subtle";

function columns(tiers: Tiers | undefined): Column<Row>[] {
  return [
    { id: "tier", header: "Tier", cell: (r) => (r.kind === "tier" ? <TierLabel row={r.tier} tiers={tiers} /> : <ModelLabel model={r.model.model} />) },
    { id: "share", header: "Share", align: "right", width: "w-36", cell: (r) => <ShareBar share={sums(r).share} dim={r.kind === "model"} /> },
    { id: "cost", header: "Cost (est.)", align: "right", width: "w-28", cell: (r) => <span className={cn(sub(r))}><CostCell usd={sums(r).cost_usd} unpriced={sums(r).unpriced} /></span> },
    { id: "requests", header: "Requests", align: "right", width: "w-24", hideBelow: "sm", cell: (r) => <span className={cn(sub(r))}>{fmtInt(sums(r).requests)}</span> },
    { id: "cache", header: "Cache hit", align: "right", width: "w-24", hideBelow: "md", cell: (r) => <span className={cn(sub(r))}>{sums(r).requests ? fmtPct(cacheHitRate(sums(r))) : "—"}</span> },
    {
      id: "per", header: "Cost / request", align: "right", width: "w-28", hideBelow: "md",
      cell: (r) => <span className={cn(sub(r))}>{sums(r).requests ? fmtUsd(sums(r).cost_usd / sums(r).requests) : "—"}</span>,
    },
  ];
}

/** Cost by tier table: one row per tier (think → work → basic → other) with indented model sub-rows. */
export function TierTable({ rows, tiers, loading, error, onRetry }: { rows: TierRow[] | undefined; tiers: Tiers | undefined; loading?: boolean; error?: Error; onRetry?: () => void }) {
  const flat = rows?.flatMap((t): Row[] => [{ kind: "tier", tier: t }, ...t.models.map((m): Row => ({ kind: "model", tier: t, model: m }))]);
  return (
    <DataTable
      label="Cost by tier"
      rows={flat}
      columns={columns(tiers)}
      rowKey={(r) => (r.kind === "tier" ? r.tier.tier : `${r.tier.tier}/${r.model.model}`)}
      loading={loading}
      error={error}
      onRetry={onRetry}
      skeletonRows={4}
    />
  );
}
