import { useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import { CircleHelp, type LucideIcon } from "lucide-react";
import { FAMILIES, type Page, type RoleRow } from "../../server/dashboard.types.ts";
import { DataTable, type Column } from "@/components/data.table.tsx";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { ByModelTable, ByRoleTable, ShareBar, usageColumns } from "@/components/role.tables.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import { TierBadge } from "@/components/tier.badge.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtModel, fmtTokens } from "@/lib/format.ts";
import { FAMILY_ICON, KPI_ICON, NAV_ICON, TIER_ICON } from "@/lib/icon.map.ts";
import { TIER_ORDER, modelFamily } from "@/lib/model.tier.ts";
import type { Range } from "@/lib/range.ts";
import { configuredTierMismatch, roleKind, sumUsage, withTier, type TieredRow } from "@/lib/roles.aggregate.ts";
import { runClientTable, groupBy } from "@/lib/table.client.ts";
import { useViewPrefs } from "@/lib/use.view.prefs.ts";
import { NO_GROUP, PAGE_SIZES, parseTableQuery, patchTable, tableParams, type TableSpec, type TableState } from "@/lib/table.query.ts";
import { withParams } from "@/lib/hash.route.ts";

/** Rows fetched once; the tables aggregate client-side. */
const ROLES_FETCH_SIZE = 200;
const Layers = KPI_ICON.tokens;
const TABLE_ID = "roles";
const DEFAULT_GROUP = "tier";
const RANGE_LABEL: Record<Range, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };
const KINDS = ["preset", "custom", "built-in"];
const SPEC: TableSpec = {
  sorts: ["cost", "requests", "tokens", "role", "model"], defaultSort: "cost", defaultDir: "desc",
  groups: [DEFAULT_GROUP, "role", "family", NO_GROUP], facets: { tier: TIER_ORDER, family: FAMILIES, kind: KINDS },
};
const tokens = (r: TieredRow) => r.input + r.output + r.cache_read + r.cache_write;
const GROUP_KEY: Record<string, (r: TieredRow) => string> = { tier: (r) => r.tier, role: (r) => r.role, family: (r) => modelFamily(r.model) };


/** Roles × models (grouped by tier) plus By model and By role tables, all aggregated client-side from one fetch. */
export function RolesPage({ since, range, dataVersion, params, tiers, roles }: PageProps) {
  const [retry, setRetry] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const { hidden, density, toggleCol, setDensity } = useViewPrefs(TABLE_ID);
  const { data, error, loading } = useApi<Page<RoleRow>>("/api/roles", { since, page: 1, pageSize: ROLES_FETCH_SIZE }, dataVersion + retry);
  const route = { path: "/roles", params: params ?? new URLSearchParams() };
  const state: TableState = parseTableQuery(route.params, SPEC);
  const group = route.params.has("group") ? state.group : DEFAULT_GROUP;
  const go = (p: Partial<TableState>) => {
    const next = patchTable({ ...state, group }, p);
    location.hash = withParams(route, { ...tableParams(next, SPEC), group: next.group === DEFAULT_GROUP ? undefined : next.group });
  };

  const rows = withTier(data?.items ?? [], tiers);
  const total = sumUsage(rows).cost_usd;
  const share = (r: { cost_usd: number }) => (total > 0 ? r.cost_usd / total : 0);
  const key = (r: TieredRow) => `${r.role}\u0000${r.model}`;
  const t = runClientTable(rows, state, {
    text: (r) => `${r.role} ${r.model}`,
    facets: { tier: (r) => r.tier, family: (r) => modelFamily(r.model), kind: (r) => roleKind(r.role, roles) },
    sort: { cost: (r) => r.cost_usd, requests: (r) => r.requests, tokens, role: (r) => r.role, model: (r) => r.model },
  });

  const columns: Column<TieredRow>[] = [
    {
      id: "role", header: "Role", sortKey: "role", cell: (r) => {
        const hint = configuredTierMismatch(r.role, r.tier, roles);
        return (
          <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="inline-flex items-center gap-1.5"><RoleBadge role={r.role} roles={roles} />
              {hint && <Tooltip focusable content={`Configured tier: ${hint}`}><CircleHelp aria-label={`Configured tier: ${hint}`} className="size-3.5 text-muted-foreground" /></Tooltip>}
            </span>
            <span className="sm:hidden"><ModelBadge model={r.model} /></span>
          </span>
        );
      },
    },
    { id: "model", header: "Model", sortKey: "model", cell: (r) => <ModelBadge model={r.model} />, width: "w-44", hideBelow: "sm" },
    ...usageColumns<TieredRow>(share),
  ];
  const labelOf = (k: string, r: TieredRow) =>
    group === "tier" ? <span className="inline-flex items-center gap-2"><TierBadge tier={r.tier} tiers={tiers} />{r.tier !== "other" && tiers?.[r.tier] && <span className="font-mono text-xs text-muted-foreground">{fmtModel(tiers[r.tier])}</span>}</span>
    : group === "role" ? <RoleBadge role={k} roles={roles} /> : <span className="capitalize">{k}</span>;
  const specs: GroupSpec<TieredRow>[] | undefined = group === NO_GROUP ? undefined : groupBy(t.filtered, GROUP_KEY[group]!)
    .sort((a, b) => group === "tier" ? TIER_ORDER.indexOf(a.rows[0]!.tier) - TIER_ORDER.indexOf(b.rows[0]!.tier) : sumUsage(b.rows).cost_usd - sumUsage(a.rows).cost_usd)
    .map((g) => {
      const u = sumUsage(g.rows);
      return {
        key: g.key, label: labelOf(g.key, g.rows[0]!), count: g.rows.length, rows: g.rows, open: !closed.includes(g.key),
        onToggle: () => setClosed((c) => (c.includes(g.key) ? c.filter((x) => x !== g.key) : [...c, g.key])),
        totals: { requests: fmtInt(u.requests), tokens: fmtTokens(u.input + u.output + u.cache_read + u.cache_write), cost: <CostCell usd={u.cost_usd} unpriced={u.unpriced} />, share: <ShareBar share={share(u)} /> },
      };
    });

  const facet = (id: string, label: string, icon: LucideIcon, opts: { value: string; label: string; icon?: LucideIcon }[]) => ({
    id, label, icon, selected: state.filters[id] ?? [], onChange: (v: string[]) => go({ filters: { ...state.filters, [id]: v } }),
    options: opts.map((o) => ({ ...o, count: t.counts[id]?.get(o.value) ?? 0 })),
  });
  const reset = () => go({ q: "", filters: {}, group: DEFAULT_GROUP });
  const models = new Set(rows.map((r) => r.model)).size;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Roles" description={`${RANGE_LABEL[range]} · ${new Set(rows.map((r) => r.role)).size} roles · ${models} models`} />
      <TableToolbar
        search={{ value: state.q, onChange: (q) => go({ q }), placeholder: "Search role or model", label: "Search roles" }}
        facets={[
          facet("tier", "Tier", Layers, TIER_ORDER.map((v) => ({ value: v, label: v, icon: TIER_ICON[v] }))),
          facet("family", "Model", FAMILY_ICON.opus, FAMILIES.map((v) => ({ value: v, label: v, icon: FAMILY_ICON[v] }))),
          facet("kind", "Kind", NAV_ICON.roles, KINDS.map((v) => ({ value: v, label: v }))),
        ]}
        group={{ value: group, options: [{ value: NO_GROUP, label: "No grouping" }, { value: "tier", label: "Tier" }, { value: "role", label: "Role" }, { value: "family", label: "Model family" }], onChange: (g) => go({ group: g }) }}
        view={{
          columns: columns.map((c) => ({ id: c.id, label: String(c.header), visible: !hidden.includes(c.id) })),
          onToggle: toggleCol,
          density, onDensity: setDensity,
        }}
        onReset={reset}
        summary={data && data.total > data.items.length ? `Showing the first ${fmtInt(data.items.length)} of ${fmtInt(data.total)} role × model rows.` : undefined}
      />
      <DataTable
        label="Roles × models" rows={group === NO_GROUP ? t.page : t.filtered} groups={specs} columns={columns} rowKey={key} hidden={hidden} density={density}
        sort={{ key: state.sort, dir: state.dir }} onSort={(s) => go({ sort: s.key, dir: s.dir })}
        loading={loading} error={error && new Error(`Couldn't load roles. ${error.message}`)} onRetry={() => setRetry((n) => n + 1)}
        empty={state.q || Object.values(state.filters).some((f) => f.length) ? "No roles match these filters." : "No role usage in this range."}
      />
      {group === NO_GROUP && <TablePagination label="Roles" page={state.page} pageSize={state.size} total={t.total} sizes={PAGE_SIZES} onPage={(page) => go({ page })} onPageSize={(size) => go({ size })} />}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ByModelTable rows={rows} tiers={tiers} />
          <ByRoleTable rows={rows} tiers={tiers} roles={roles} />
        </div>
      )}
    </div>
  );
}
