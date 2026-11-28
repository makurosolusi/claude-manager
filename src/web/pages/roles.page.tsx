import { useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import type { LucideIcon } from "lucide-react";
import { FAMILIES, type Page, type RoleRow } from "../../server/dashboard.types.ts";
import { NoMatchState } from "@/components/client.table.tsx";
import { DataTable, type Column } from "@/components/data.table.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { columnLabel, nameColumns, usageColumns } from "@/components/roles.columns.tsx";
import { roleGroups } from "@/components/roles.groups.tsx";
import { ExpandAllButton, ViewSwitch } from "@/components/roles.view.switch.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt } from "@/lib/format.ts";
import { withParams } from "@/lib/hash.route.ts";
import { CUSTOM_ROLE_ICON, FAMILY_ICON, KPI_ICON, NAV_ICON, ROLE_ICON, TIER_ICON } from "@/lib/icon.map.ts";
import { FAMILY_LABEL, TIER_ORDER, modelFamily } from "@/lib/model.tier.ts";
import type { Range } from "@/lib/range.ts";
import { ROLE_KINDS, roleKind, sumUsage, withTier, type TieredRow } from "@/lib/roles.aggregate.ts";
import { DEFAULT_VIEW, flipsFor, groupKeyOf, parseView, type RolesView } from "@/lib/roles.view.ts";
import { runClientTable } from "@/lib/table.client.ts";
import { NO_GROUP, parseTableQuery, patchTable, tableParams, type TableSpec, type TableState } from "@/lib/table.query.ts";
import { useViewPrefs } from "@/lib/use.view.prefs.ts";

/** Rows fetched once; the table aggregates client-side. */
const ROLES_FETCH_SIZE = 200;
const Layers = KPI_ICON.tokens;
const TABLE_ID = "roles";
const RANGE_LABEL: Record<Range, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };
const EXTERNAL_HINT = "Claude Code built-in, plugin or ~/.claude/agents agent, not managed by claude-manager";
/** Group sets larger than this start collapsed; the subtotal row is the summary. */
const GROUP_AUTO_COLLAPSE = 6;
const KIND_LABEL = { preset: "Preset", custom: "Custom", external: "External" };
const KIND_ICON = { preset: NAV_ICON.roles, custom: CUSTOM_ROLE_ICON, external: ROLE_ICON.subagent! };
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const SPEC: TableSpec = {
  sorts: ["cost", "requests", "tokens", "rerouted", "share", "role", "model"], defaultSort: "cost", defaultDir: "desc",
  groups: [NO_GROUP], facets: { tier: TIER_ORDER, family: FAMILIES, kind: [...ROLE_KINDS] },
};
const tokens = (r: TieredRow) => r.input + r.output + r.cache_read + r.cache_write;
const countOf = (n: number, noun: string) => `${fmtInt(n)} ${noun}${n === 1 ? "" : "s"}`;

/** Spend and usage by role and model: one table, switchable between By role, By model and By tier, aggregated client-side from one fetch. */
export function RolesPage({ since, range, dataVersion, params, tiers, roles }: PageProps) {
  const [retry, setRetry] = useState(0);
  /** Per view: keys whose open state differs from the default (open, or collapsed for big sets). */
  const [flipped, setFlipped] = useState<Record<string, string[]>>({});
  const { hidden, density, toggleCol, setDensity } = useViewPrefs(TABLE_ID);
  const { data, error, loading, stale } = useApi<Page<RoleRow>>("/api/roles", { since, range, page: 1, pageSize: ROLES_FETCH_SIZE }, dataVersion + retry);
  const route = { path: "/roles", params: params ?? new URLSearchParams() };
  const state: TableState = parseTableQuery(route.params, SPEC);
  const view = parseView(route.params);
  /** `group` is the pre-v0.3 spelling of `view`; writing any state drops it. */
  const go = (p: Partial<TableState>, v: RolesView = view) =>
    (location.hash = withParams(route, { ...tableParams(patchTable(state, p), SPEC), view: v === DEFAULT_VIEW ? undefined : v, group: undefined }));

  const rows = withTier(data?.items ?? [], tiers);
  const total = sumUsage(rows).cost_usd;
  const t = runClientTable(rows, state, {
    text: (r) => `${r.role} ${r.model}`,
    facets: { tier: (r) => r.tier, family: (r) => modelFamily(r.model), kind: (r) => roleKind(r.role, roles) },
    unique: { kind: (r) => r.role },
    sort: { cost: (r) => r.cost_usd, requests: (r) => r.requests, rerouted: (r) => r.rerouted, tokens, share: (r) => r.cost_usd, role: (r) => r.role, model: (r) => r.model },
  });

  const keys = [...new Set(t.filtered.map((r) => groupKeyOf(view, r)))];
  const collapsed = keys.length > GROUP_AUTO_COLLAPSE;
  const flips = flipped[view] ?? [];
  const isOpen = (k: string) => flips.includes(k) === collapsed;
  const allOpen = keys.every(isOpen);
  const setFlips = (f: string[]) => setFlipped((all) => ({ ...all, [view]: f }));
  const groups = roleGroups(t.filtered, {
    view, roles, tiers, isOpen, share: (u) => (total > 0 ? u.cost_usd / total : 0),
    toggle: (k) => setFlips(flips.includes(k) ? flips.filter((x) => x !== k) : [...flips, k]),
  });
  const columns: Column<TieredRow>[] = [...nameColumns(view, roles), ...usageColumns<TieredRow>((r) => (total > 0 ? r.cost_usd / total : 0))];

  const facet = (id: string, label: string, icon: LucideIcon, opts: { value: string; label: string; icon?: LucideIcon; hint?: string }[]) => ({
    id, label, icon, selected: state.filters[id] ?? [], onChange: (v: string[]) => go({ filters: { ...state.filters, [id]: v } }),
    options: opts.map((o) => ({ ...o, count: t.counts[id]?.get(o.value) ?? 0 })),
  });
  const filtered = state.q !== "" || Object.values(state.filters).some((f) => f.length);
  const reset = () => go({ q: "", filters: {} }, DEFAULT_VIEW);
  const counts = data ? `${countOf(new Set(rows.map((r) => r.role)).size, "role")} · ${countOf(new Set(rows.map((r) => r.model)).size, "model")}` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={NAV_ICON.roles} title="Roles"
        description={<>{RANGE_LABEL[range]} · Spend and usage by agent role and model. Manage agents on the <a href="#/agents" className="rounded-sm underline underline-offset-2 outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">Agents page</a>.</>}
        actions={counts && <span className="text-[13px] text-muted-foreground tabular-nums">{counts}</span>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <ViewSwitch value={view} onChange={(v) => go({}, v)} />
        <div className="sm:ml-auto"><ExpandAllButton allOpen={allOpen} onClick={() => setFlips(flipsFor(keys, !allOpen, collapsed))} /></div>
      </div>
      <TableToolbar
        search={{ value: state.q, onChange: (q) => go({ q }), placeholder: "Search role or model", label: "Search roles" }}
        facets={[
          facet("tier", "Tier", Layers, TIER_ORDER.map((v) => ({ value: v, label: cap(v), icon: TIER_ICON[v] }))),
          facet("family", "Model", FAMILY_ICON.opus, FAMILIES.map((v) => ({ value: v, label: FAMILY_LABEL[v], icon: FAMILY_ICON[v] }))),
          facet("kind", "Kind", NAV_ICON.roles, ROLE_KINDS.map((v) => ({ value: v, label: KIND_LABEL[v], icon: KIND_ICON[v], hint: v === "external" ? EXTERNAL_HINT : undefined }))),
        ]}
        view={{
          columns: columns.map((c) => ({ id: c.id, label: columnLabel(c), visible: !hidden.includes(c.id) })),
          onToggle: toggleCol, density, onDensity: setDensity,
        }}
        onReset={filtered || view !== DEFAULT_VIEW ? reset : undefined}
        summary={data && data.total > data.items.length ? `Showing the first ${fmtInt(data.items.length)} of ${fmtInt(data.total)} role × model rows.` : undefined}
      />
      <DataTable
        label="Usage by role and model" rows={data ? t.filtered : undefined} groups={data && groups.length ? groups : undefined} columns={columns} rowKey={(r) => `${r.role}\u0000${r.model}`} hidden={hidden} density={density}
        sort={{ key: state.sort, dir: state.dir }} onSort={(s) => go({ sort: s.key, dir: s.dir })}
        loading={loading} stale={stale} error={error && new Error(`Couldn't load roles. ${error.message}`)} onRetry={() => setRetry((n) => n + 1)}
        empty={filtered ? <NoMatchState noun="roles" onReset={reset} /> : "No role usage in this range."}
      />
    </div>
  );
}
