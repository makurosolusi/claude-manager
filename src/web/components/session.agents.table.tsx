import { useMemo } from "react";
import type { AgentNode } from "../../server/dashboard.types.ts";
import { NoMatchState } from "@/components/client.table.tsx";
import { DataTable } from "@/components/data.table.tsx";
import type { FacetDef } from "@/components/facet.filter.tsx";
import { SESSION_AGENT_HIDEABLE, sessionAgentColumns } from "@/components/session.agents.columns.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { fmtInt } from "@/lib/format.ts";
import { withParams } from "@/lib/hash.route.ts";
import { KPI_ICON } from "@/lib/icon.map.ts";
import { roleIcon } from "@/lib/role.icon.ts";
import { SESSION_AGENTS_SIZE, SESSION_AGENTS_SPEC, sessionAgentOptions } from "@/lib/session.agents.ts";
import { runClientTable } from "@/lib/table.client.ts";
import { patchTable, tableParams } from "@/lib/table.query.ts";
import { facetOptions, useTableView } from "@/lib/use.table.view.ts";

const PAGE_SIZES = [SESSION_AGENTS_SIZE, 50, 100] as const;

/** Subagent runs of one session as a client-side table (one fetch, filtering in the browser); search, role facet, sort and page live in the URL hash. */
export function SessionAgentsTable({ agents, roles, path, params }: { agents: AgentNode[]; roles?: readonly RoleMeta[]; path: string; params: URLSearchParams }) {
  const base = useTableView({ id: "session-agents", path, params, spec: SESSION_AGENTS_SPEC, hideable: SESSION_AGENT_HIDEABLE });
  // The URL carries `size` only when it differs from the 50 default; this table defaults to 25 instead.
  const state = { ...base.state, size: params.has("size") ? base.state.size : SESSION_AGENTS_SIZE };
  const go = (patch: Partial<typeof state>) => {
    const next = patchTable(state, patch);
    location.hash = withParams({ path, params }, { ...tableParams(next, SESSION_AGENTS_SPEC), size: next.size === SESSION_AGENTS_SIZE ? undefined : String(next.size) });
  };
  const view = { ...base, state, go, reset: () => go({ q: "", filters: {} }) };
  const result = useMemo(() => runClientTable(agents, state, sessionAgentOptions), [agents, JSON.stringify(state)]);
  const columns = useMemo(() => sessionAgentColumns(roles), [roles]);

  const selected = state.filters.role ?? [];
  const known = [...new Set([...result.counts.role!.keys(), ...selected])].sort();
  const roleFacet: FacetDef = {
    id: "role", label: "Role", icon: KPI_ICON.agents, selected,
    options: facetOptions(known.map((value) => ({ value, label: value, icon: roleIcon(value, roles) })), result.counts.role),
    onChange: (next) => go({ filters: { ...state.filters, role: next } }),
  };
  const filtering = state.q !== "" || selected.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <TableToolbar
        search={{ value: state.q, onChange: (q) => go({ q }), placeholder: "Search role, task or model…", label: "Search runs" }}
        facets={[roleFacet]}
        view={view.viewProps}
        onReset={view.reset}
        summary={`${fmtInt(result.total)} of ${fmtInt(agents.length)} runs`}
      />
      <DataTable<AgentNode>
        label="Subagent runs"
        rows={result.page}
        columns={columns}
        rowKey={(a) => a.id}
        sort={{ key: state.sort, dir: state.dir }}
        onSort={(s) => go({ sort: s.key, dir: s.dir })}
        density={view.density}
        hidden={view.hidden}
        empty={filtering ? <NoMatchState noun="runs" onReset={view.reset} /> : "No subagents in this session."}
      />
      <TablePagination label="Subagent runs" noun="runs" sizes={PAGE_SIZES} page={state.page} pageSize={state.size} total={result.total} onPage={(page) => go({ page })} onPageSize={(size) => go({ size })} />
    </div>
  );
}
