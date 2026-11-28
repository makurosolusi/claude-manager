import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PageProps } from "@/lib/page.props.ts";
import type { AgentRow, AgentsResponse } from "../../server/agents.types.ts";
import { AgentForm } from "@/components/agent.form.tsx";
import { AgentFormHeader } from "@/components/agent.form.header.tsx";
import { AgentNotice } from "@/components/agent.notice.tsx";
import { ReadOnlyBadge } from "@/components/agent.readonly.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { holdNotice, useNotice, useWriteMode, READ_ONLY_REASON } from "@/lib/agent.write.ts";
import { AgentBanner } from "@/components/agent.banner.tsx";
import { AGENT_HIDEABLE, agentColumns } from "@/components/agents.columns.tsx";
import { ClientTable, type ClientGrouping } from "@/components/client.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { useApi } from "@/lib/api.client.ts";
import { AGENTS_DEFAULT_GROUP, AGENTS_PATH, AGENTS_SPEC, TIER_PINNED, agentGroupKey, agentTableOptions, orderByGroup } from "@/lib/agents.table.ts";
import { fmtInt } from "@/lib/format.ts";
import { hashHref, withParams } from "@/lib/hash.route.ts";
import { NAV_ICON, TIER_ICON, UI_ICON } from "@/lib/icon.map.ts";
import type { TierKey } from "@/lib/model.tier.ts";
import { runClientTable } from "@/lib/table.client.ts";
import { NO_GROUP, patchTable, tableParams, type TableState } from "@/lib/table.query.ts";
import { facetOptions, useTableView, type TableView } from "@/lib/use.table.view.ts";

const SUBTITLE = "What each agent does, which model it runs on, and where its file lives.";
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const KIND_OPTS = ["preset", "custom", "external"], TIER_OPTS = ["think", "work", "basic", TIER_PINNED, "none"];
const SCOPE_OPTS = ["user", "project", "both", "none"], STATUS_OPTS = ["enabled", "disabled"];
const opts = (vs: string[]) => vs.map((value) => ({ value, label: value === TIER_PINNED ? "Pinned" : cap(value), icon: Object.hasOwn(TIER_ICON, value) ? TIER_ICON[value as TierKey] : undefined }));

/** Table view whose default group is Kind: the URL carries `group` only when it differs, so "No grouping" is written out as `group=none`. */
function useAgentsView(params: URLSearchParams): TableView {
  const base = useTableView({ id: "agents", path: AGENTS_PATH, params, spec: AGENTS_SPEC, hideable: AGENT_HIDEABLE });
  const state: TableState = { ...base.state, group: params.has("group") ? base.state.group : AGENTS_DEFAULT_GROUP };
  const go = (patch: Partial<TableState>) => {
    const next = patchTable(state, patch);
    location.hash = withParams({ path: AGENTS_PATH, params }, { ...tableParams(next, AGENTS_SPEC), group: next.group === AGENTS_DEFAULT_GROUP ? undefined : next.group });
  };
  return { ...base, state, go, reset: () => go({ q: "", group: AGENTS_DEFAULT_GROUP, filters: {} }) };
}

/** Agents list: presets, custom roles and external agents with model chain, tools, scope and 30-day usage; filtering runs in the browser over one fetch. */
export function AgentsPage({ dataVersion, params, tiers, roles }: PageProps) {
  const [retry, setRetry] = useState(0);
  const write = useWriteMode();
  const newParam = params.get("new") === "1";
  const creating = newParam && write === true;
  const [notice, setNotice] = useNotice(AGENTS_PATH, String(params));
  useEffect(() => {
    if (!newParam || write !== false) return;
    holdNotice({ tone: "info", text: `Creating agents is unavailable. ${READ_ONLY_REASON}` }, AGENTS_PATH);
    location.replace(`#${AGENTS_PATH}`);
  }, [newParam, write]);
  const view = useAgentsView(params);
  const { state } = view;
  const { data, error, loading, stale } = useApi<AgentsResponse>("/api/agents", {}, dataVersion + retry);
  const result = useMemo(() => {
    if (!data) return undefined;
    const r = runClientTable(data.items, state, agentTableOptions);
    return { ...r, filtered: orderByGroup(r.filtered, state.group) };
  }, [data, JSON.stringify(state)]);
  const showRerouted = !!data?.items.some((r) => r.usage.rerouted_pct !== null);
  const columns = useMemo(() => agentColumns(roles, data?.tiers ?? tiers, showRerouted), [roles, data?.tiers, tiers, showRerouted]);

  const grouping: ClientGrouping<AgentRow> = {
    options: [{ value: "kind", label: "Kind" }, { value: "tier", label: "Tier" }, { value: "scope", label: "Scope" }, { value: NO_GROUP, label: "No grouping" }],
    of: (r) => { const key = agentGroupKey(state.group, r); return { key, label: key === TIER_PINNED ? "Pinned" : cap(key) }; },
    totals: (rows) => ({ requests: fmtInt(rows.reduce((a, r) => a + r.usage.requests, 0)), cost: <CostCell usd={rows.reduce((a, r) => a + r.usage.cost_usd, 0)} /> }),
  };
  const facet = (id: string, label: string, icon: LucideIcon, values: ReturnType<typeof opts>) => ({
    id, label, icon, options: facetOptions(values, result?.counts[id]), selected: state.filters[id] ?? [],
    onChange: (next: string[]) => view.go({ filters: { ...state.filters, [id]: next } }),
  });
  const total = data?.items.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {creating
        ? <AgentFormHeader backHref={`#${AGENTS_PATH}`} backLabel="Agents" title="New agent" />
        : <PageHeader title="Agents" icon={NAV_ICON.agents} description={SUBTITLE}
            actions={write === false ? <ReadOnlyBadge /> : write ? <a href="#/agents?new=1" className={buttonVariants()}><Plus aria-hidden />New agent</a> : undefined} />}
      <AgentNotice notice={notice} onClose={() => setNotice(null)} />
      {data && <AgentBanner data={data} />}
      {creating ? (data
        ? <AgentForm tiers={data.tiers} knownTools={data.known_tools} etag={data.etag} onReload={() => setRetry((n) => n + 1)} />
        : <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      ) : <ClientTable
        label="Agents" noun="agents" empty="No agents." view={view} columns={columns}
        facets={[
          facet("kind", "Kind", NAV_ICON.roles, opts(KIND_OPTS)),
          facet("tier", "Tier", UI_ICON.tier, opts(TIER_OPTS)),
          facet("scope", "Scope", UI_ICON.project, opts(SCOPE_OPTS)),
          facet("status", "Status", UI_ICON.check, opts(STATUS_OPTS)),
        ]}
        searchPlaceholder="Search name, description or tool…" grouping={grouping} result={result}
        summary={error ? undefined : `${fmtInt(result?.filtered.length ?? 0)} of ${fmtInt(total)} agents${data?.truncated ? " · list truncated" : ""} · last 30 days`}
        rowKey={(r) => r.name} rowHref={(r) => hashHref(`${AGENTS_PATH}/${encodeURIComponent(r.name)}`)}
        loading={loading} stale={stale} error={error && new Error(`Couldn't load agents. ${error.message}`)} onRetry={() => setRetry((n) => n + 1)}
      />}
    </div>
  );
}
