import { DataTable, type Column } from "@/components/data.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { cacheHitRate, fmtInt, fmtModel, fmtPct, fmtUsd } from "@/lib/format.ts";
import { ModelDot } from "@/components/model.badge.tsx";
import { TierBadge } from "@/components/tier.badge.tsx";
import { FAMILY_CLASSES } from "@/lib/color.tokens.ts";
import { tierFamily, type Tiers } from "@/lib/model.tier.ts";
import type { TierModelRow, TierRow } from "@/lib/tier.cost.ts";
import { cn } from "@/lib/cn.ts";
import { ShareBar } from "@/components/share.bar.tsx";

/** Flattened row: a tier header or one of its model sub-rows. */
type Row = { kind: "tier"; tier: TierRow } | { kind: "model"; tier: TierRow; model: TierModelRow };
const sums = (r: Row) => (r.kind === "tier" ? r.tier : r.model);

function TierLabel({ row, tiers }: { row: TierRow; tiers: Tiers | undefined }) {
  const configured = row.tier !== "other" ? tiers?.[row.tier] : undefined;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <TierBadge tier={row.tier} tiers={tiers} />
      {configured && <span className="truncate font-mono text-xs text-fg-subtle">{fmtModel(configured)}</span>}
    </span>
  );
}

function ModelLabel({ model }: { model: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 pl-4">
      <ModelDot model={model} />
      <span className="truncate font-mono text-xs text-fg-subtle" title={model}>{fmtModel(model)}</span>
    </span>
  );
}

const sub = (r: Row) => r.kind === "model" && "text-xs text-fg-subtle";

function columns(tiers: Tiers | undefined): Column<Row>[] {
  return [
    { id: "tier", header: "Tier", cell: (r) => (r.kind === "tier" ? <TierLabel row={r.tier} tiers={tiers} /> : <ModelLabel model={r.model.model} />) },
    { id: "requests", header: "Requests", align: "right", width: "w-24", hideBelow: "sm", cell: (r) => <span className={cn(sub(r))}>{fmtInt(sums(r).requests)}</span> },
    { id: "cache", header: "Cache hit", align: "right", width: "w-24", hideBelow: "md", cell: (r) => <span className={cn(sub(r))}>{sums(r).requests ? fmtPct(cacheHitRate(sums(r))) : "—"}</span> },
    {
      id: "per", header: "Cost / request", align: "right", width: "w-28", hideBelow: "md",
      cell: (r) => <span className={cn(sub(r))}>{sums(r).requests ? fmtUsd(sums(r).cost_usd / sums(r).requests) : "—"}</span>,
    },
    { id: "cost", header: "Cost (est.)", align: "right", width: "w-28", cell: (r) => <span className={cn(sub(r))}><CostCell usd={sums(r).cost_usd} unpriced={sums(r).unpriced} /></span> },
    { id: "share", header: "Share", align: "right", width: "w-28", hideBelow: "sm", cell: (r) => <ShareBar share={sums(r).share} dim={r.kind === "model"} fill={FAMILY_CLASSES[tierFamily(r.tier.tier, tiers)].dot} /> },
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
