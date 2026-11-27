import { useState } from "react";
import type { RequestRow, RequestsResponse } from "../../server/session.detail.types.ts";
import { DataTable } from "@/components/data.table.tsx";
import { GroupedRequests } from "@/components/requests.grouped.tsx";
import { requestColumns } from "@/components/requests.columns.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt } from "@/lib/format.ts";
import { useHashRoute, withParams } from "@/lib/hash.route.ts";
import { requestFacets } from "@/lib/requests.facets.ts";
import { REQUEST_SPEC, requestsPath } from "@/lib/requests.query.ts";
import { useViewPrefs } from "@/lib/use.view.prefs.ts";
import { NO_GROUP, parseTableQuery, patchTable, tableParams, type TableState } from "@/lib/table.query.ts";

const TABLE_ID = "requests";
const GROUP_OPTIONS = [{ value: "none", label: "No grouping" }, { value: "agent", label: "Agent" }, { value: "family", label: "Model" }, { value: "stop", label: "Stop" }];

/** Server-side requests table of one session; sort, page, group and facets live in the URL hash. */
export function RequestsTable({ sessionId, roles, tick = 0 }: { sessionId: string; roles?: readonly RoleMeta[]; tick?: number }) {
  const columns = requestColumns(roles);
  const route = useHashRoute();
  const state = parseTableQuery(route.params, REQUEST_SPEC);
  const grouped = state.group !== NO_GROUP;
  const go = (patch: Partial<TableState>) => (location.hash = withParams(route, tableParams(patchTable(state, patch), REQUEST_SPEC)));
  const [retry, setRetry] = useState(0);
  const { hidden, density, toggleCol, setDensity } = useViewPrefs(TABLE_ID);

  // Grouped mode still needs facet counts and the total: ask the flat endpoint for a single row.
  const flat = useApi<RequestsResponse>(
    requestsPath(sessionId),
    { ...state.filters, sort: state.sort, dir: state.dir, page: grouped ? 1 : state.page, pageSize: grouped ? 1 : state.size, facets: 1 },
    retry + tick,
  );
  const filtered = Object.values(state.filters).some((v) => v.length > 0);
  const reset = () => go({ filters: {}, group: NO_GROUP });
  const empty = filtered ? (
    <span className="inline-flex flex-wrap items-center justify-center gap-2">
      No requests match these filters.
      <Button size="xs" variant="outline" onClick={reset}>Reset filters</Button>
    </span>
  ) : "No requests recorded for this session.";
  const total = flat.data?.total;

  return (
    <div className="flex flex-col gap-3">
      <TableToolbar
        facets={requestFacets(flat.data?.facets, state, (filters) => go({ filters }))}
        group={{ value: state.group, options: GROUP_OPTIONS, onChange: (group) => go({ group }) }}
        view={{
          columns: columns.slice(1).map((c) => ({ id: c.id, label: String(c.header), visible: !hidden.includes(c.id) })),
          onToggle: toggleCol,
          density,
          onDensity: setDensity,
        }}
        onReset={reset}
        summary={total === undefined ? "Loading…" : `${fmtInt(total)} ${total === 1 ? "request" : "requests"}`}
      />
      {grouped ? (
        <GroupedRequests key={`${state.group}|${state.sort}|${state.dir}|${JSON.stringify(state.filters)}`} sessionId={sessionId} state={state} go={go} columns={columns} hidden={hidden} density={density} empty={empty} roles={roles} tick={tick} />
      ) : (
        <>
          <DataTable<RequestRow>
            label="Requests"
            rows={flat.data?.items}
            columns={columns}
            rowKey={(r) => r.message_id}
            sort={{ key: state.sort, dir: state.dir }}
            onSort={(s) => go({ sort: s.key, dir: s.dir })}
            hidden={hidden}
            density={density}
            loading={flat.loading}
            error={flat.error && new Error(`Couldn't load requests. ${flat.error.message}`)}
            onRetry={() => setRetry((n) => n + 1)}
            empty={empty}
          />
          {flat.data && !flat.error && (
            <TablePagination label="Requests" page={state.page} pageSize={state.size} total={flat.data.total} onPage={(page) => go({ page })} onPageSize={(size) => go({ size })} />
          )}
        </>
      )}
    </div>
  );
}
