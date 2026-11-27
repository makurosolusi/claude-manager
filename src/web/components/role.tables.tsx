import { useState, type ReactNode } from "react";
import type { Usage } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import { DataTable, type Column, type Sort } from "@/components/data.table.tsx";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TierBadge } from "@/components/tier.badge.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { cacheHitRate, fmtInt, fmtPct, fmtTokens } from "@/lib/format.ts";
import { byModel, byRole, roleKind, sumUsage, type AggRow, type TieredRow } from "@/lib/roles.aggregate.ts";
import type { Tiers } from "@/lib/model.tier.ts";
import { groupBy, runClientTable } from "@/lib/table.client.ts";

/** Rows per page in the By model / By role tables. */
export const AGG_PAGE_SIZE = 25;
const tokens = (u: Usage) => u.input + u.output + u.cache_read + u.cache_write;
const SORTS = { name: (r: AggRow) => r.key, requests: (r: AggRow) => r.requests, tokens, cost: (r: AggRow) => r.cost_usd, share: (r: AggRow) => r.share };

/** Neutral (foreground-tinted) share bar with the percentage beside it. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-8 overflow-hidden rounded-full bg-foreground/10">
        <span className="block h-full rounded-full bg-foreground/50" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="w-9 tabular-nums">{fmtPct(share)}</span>
    </span>
  );
}

/** Requests, Tokens, Cache hit, Cost (est.) and Share columns shared by the role tables; `only` keeps a subset (half-width tables), below sm only Cost stays. */
export function usageColumns<T extends Usage>(share: (r: T) => number, only?: string[]): Column<T>[] {
  const all: Column<T>[] = [
    { id: "requests", header: "Requests", cell: (r) => fmtInt(r.requests), align: "right", sortKey: "requests", width: "w-20", hideBelow: "sm" },
    { id: "tokens", header: "Tokens", cell: (r) => <TokenCell usage={r} />, align: "right", sortKey: "tokens", width: "w-20", hideBelow: "sm" },
    { id: "cache", header: "Cache hit", cell: (r) => (r.requests ? fmtPct(cacheHitRate(r)) : "—"), align: "right", width: "w-20", hideBelow: "lg" },
    { id: "cost", header: "Cost (est.)", cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} heat="aggregate" />, align: "right", sortKey: "cost", width: "w-24" },
    { id: "share", header: "Share", cell: (r) => <ShareBar share={share(r)} />, align: "right", sortKey: "share", width: "w-24", hideBelow: "md" },
  ];
  return only ? all.filter((c) => only.includes(c.id)) : all;
}

interface AggTableProps {
  label: string;
  rows: AggRow[];
  lead: Column<AggRow>[];
  tiers?: Partial<Tiers>;
  grouped?: boolean;
  /** Usage column ids kept; the tables sit half-width at lg so not all five fit beside the name. */
  keep: string[];
}

/** Searchable, sortable, paginated table of aggregated rows; `grouped` clusters the page by tier with full-set subtotals. */
function AggTable({ label, rows, lead, tiers, grouped, keep }: AggTableProps) {
  const [s, setS] = useState({ q: "", sort: "cost", dir: "desc" as Sort["dir"], page: 1, size: AGG_PAGE_SIZE, filters: {} });
  const [closed, setClosed] = useState<string[]>([]);
  const r = runClientTable(rows, s, { text: (x) => x.key, facets: {}, sort: SORTS });
  const groups: GroupSpec<AggRow>[] | undefined = grouped
    ? groupBy(r.page, (x) => x.tier).map((g) => {
        const inTier = r.filtered.filter((x) => x.tier === g.key);
        const sub = sumUsage(inTier);
        const costShare = inTier.reduce((a, x) => a + x.share, 0);
        return {
          key: g.key, label: <TierBadge tier={g.rows[0]!.tier} tiers={tiers} />, count: inTier.length,
          totals: { requests: fmtInt(sub.requests), tokens: fmtTokens(tokens(sub)), cost: <CostCell usd={sub.cost_usd} unpriced={sub.unpriced} />, share: <ShareBar share={costShare} /> },
          open: !closed.includes(g.key), onToggle: () => setClosed((c) => (c.includes(g.key) ? c.filter((k) => k !== g.key) : [...c, g.key])), rows: g.rows,
        };
      })
    : undefined;
  const patch = (p: Partial<typeof s>) => setS({ ...s, page: 1, ...p });
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{label}</h2>
        <input type="search" value={s.q} onChange={(e) => patch({ q: e.target.value })} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} className="h-11 w-44 rounded-md border border-input bg-transparent px-2.5 text-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8 dark:bg-input/30" />
      </div>
      <DataTable
        label={label} rows={r.page} groups={groups} rowKey={(x) => x.key} sort={{ key: s.sort, dir: s.dir }}
        columns={[...lead, ...usageColumns<AggRow>((x) => x.share, keep)]}
        onSort={(n) => patch({ sort: n.key, dir: n.dir })}
        empty={s.q ? `No ${label.toLowerCase()} match "${s.q}".` : "No usage in this range."}
      />
      <TablePagination label={label} page={s.page} pageSize={s.size} total={r.total} onPage={(page) => setS({ ...s, page })} onPageSize={() => undefined} sizes={[AGG_PAGE_SIZE]} />
    </section>
  );
}

const nameCol = (header: string, cell: (r: AggRow) => ReactNode): Column<AggRow> => ({ id: "name", header, cell, sortKey: "name" });

/** By model: one row per model, grouped by tier. */
export function ByModelTable({ rows, tiers }: { rows: TieredRow[]; tiers?: Partial<Tiers> }) {
  const lead = [nameCol("Model", (r) => <ModelBadge model={r.key} />), { id: "tier", header: "Tier", cell: (r: AggRow) => <TierBadge tier={r.tier} tiers={tiers} />, width: "w-24", hideBelow: "md" as const }];
  return <AggTable label="By model" rows={byModel(rows)} lead={lead} tiers={tiers} grouped keep={["tokens", "cost", "share"]} />;
}

/** By role: one row per role with its kind and tier. */
export function ByRoleTable({ rows, tiers, roles }: { rows: TieredRow[]; tiers?: Partial<Tiers>; roles?: readonly RoleMeta[] }) {
  const lead = [
    nameCol("Role", (r) => <RoleBadge role={r.key} roles={roles} />),
    { id: "kind", header: "Kind", cell: (r: AggRow) => <span className="text-muted-foreground">{roleKind(r.key, roles)}</span>, width: "w-16", hideBelow: "lg" as const },
    { id: "tier", header: "Tier", cell: (r: AggRow) => <TierBadge tier={r.tier} tiers={tiers} />, width: "w-24", hideBelow: "md" as const },
  ];
  return <AggTable label="By role" rows={byRole(rows, roles)} lead={lead} tiers={tiers} keep={["requests", "cost", "share"]} />;
}
