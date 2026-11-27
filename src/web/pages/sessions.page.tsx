import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import { FAMILIES, type Page, type SessionGroups, type SessionRow, type SessionsResponse } from "../../server/dashboard.types.ts";
import { NoMatchState } from "@/components/client.table.tsx";
import { DataTable } from "@/components/data.table.tsx";
import type { FacetDef, FacetOption } from "@/components/facet.filter.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import { useApi, useApiMany } from "@/lib/api.client.ts";
import { fmtProject } from "@/lib/format.ts";
import { CUSTOM_ROLE_ICON, FAMILY_ICON, NAV_ICON, ROLE_ICON, STATUS_ICON, UI_ICON } from "@/lib/icon.map.ts";
import { FAMILY_LABEL, type ModelFamily } from "@/lib/model.tier.ts";
import { useNow } from "@/lib/now.ts";
import type { Range } from "@/lib/range.ts";
import { STATUS_TONE } from "@/lib/status.level.ts";
import { SESSIONS_PATH, SESSIONS_SPEC, SESSION_FACET_IDS, sessionsApi, sessionsApiPath, sessionsCountLabel, sessionsHref, type GroupRef } from "@/lib/sessions.query.ts";
import { useViewPrefs } from "@/lib/use.view.prefs.ts";
import { GROUP_PREVIEW_ROWS, NO_GROUP, parseTableQuery, patchTable, type TableState } from "@/lib/table.query.ts";
import { sessionColumns } from "./sessions.columns.tsx";
import { groupSpecs } from "./sessions.groups.tsx";

const TABLE_ID = "sessions";
export const RANGE_LABEL: Record<Range, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };
const GROUP_OPTIONS = [{ value: NO_GROUP, label: "No grouping" }, { value: "project", label: "Project" }, { value: "family", label: "Model family" }, { value: "status", label: "Status" }];
const GROUP_NOUN: Record<string, string> = { project: "projects", family: "families", status: "statuses" };
const FACET_LABEL = { project: "Project", family: "Model", role: "Role", status: "Status" } as const;
const FACET_ICON = { project: UI_ICON.project, family: UI_ICON.model, role: NAV_ICON.roles, status: STATUS_ICON.live };
const FIXED_FACETS: Record<string, readonly string[]> = { family: FAMILIES, status: ["live", "idle", "ended"] };

function facetOptions(id: (typeof SESSION_FACET_IDS)[number], counts: { value: string; count: number }[] = []): FacetOption[] {
  const byValue = new Map(counts.map((c) => [c.value, c.count]));
  const values = FIXED_FACETS[id] ?? counts.map((c) => c.value);
  return values.map((value) => ({
    value,
    count: byValue.get(value) ?? 0,
    label: id === "project" ? fmtProject(value) : id === "family" ? FAMILY_LABEL[value as ModelFamily] ?? value : id === "status" ? value.charAt(0).toUpperCase() + value.slice(1) : value,
    icon: id === "family" ? FAMILY_ICON[value as ModelFamily] : id === "status" ? STATUS_ICON[value as keyof typeof STATUS_ICON] : id === "role" ? (Object.hasOwn(ROLE_ICON, value) ? ROLE_ICON[value] : CUSTOM_ROLE_ICON) : undefined,
    tone: id === "status" ? STATUS_TONE[value as keyof typeof STATUS_TONE] : undefined,
  }));
}

/** Sessions table: server-side filters, facets, sorting, paging and aggregate-first grouping; all state lives in the URL hash. */
export function SessionsPage({ since, range, dataVersion, params, roles }: PageProps) {
  const state = parseTableQuery(params, SESSIONS_SPEC);
  const grouped = state.group !== NO_GROUP;
  const go = (patch: Partial<TableState>) => (location.hash = sessionsHref(patchTable(state, patch), range));
  const now = useNow();
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<string[]>([]);
  const { hidden, density, toggleCol, setDensity } = useViewPrefs(TABLE_ID);
  useEffect(() => setOpen([]), [state.group]);

  // Grouped: the list call only supplies facets + total, so ask for one row.
  const listReq = sessionsApi(since, state, { facets: true, size: grouped ? 1 : undefined, range });
  const list = useApi<SessionsResponse>(listReq.path, listReq.query, dataVersion + retry);
  const groupsReq = grouped ? sessionsApi(since, state, { groups: true, range }) : undefined;
  const openRefs: GroupRef[] = open.map((key) => ({ by: state.group, key }));
  const groupsApi = useApi<SessionGroups>(groupsReq?.path ?? null, groupsReq?.query, dataVersion + retry);
  const results = useApiMany<Page<SessionRow>>(openRefs.map((only) => sessionsApiPath(since, state, { only, size: GROUP_PREVIEW_ROWS, range })), dataVersion + retry);

  const columns = useMemo(() => sessionColumns(now, roles, (r) => `#${SESSIONS_PATH}/${encodeURIComponent(r.id)}`), [now, roles]);
  const facets: FacetDef[] = SESSION_FACET_IDS.map((id) => ({
    id, label: FACET_LABEL[id], icon: FACET_ICON[id], options: facetOptions(id, list.data?.facets?.[id]), selected: state.filters[id] ?? [],
    onChange: (next) => go({ filters: { ...state.filters, [id]: next } }),
  }));
  const reset = () => go({ q: "", group: NO_GROUP, filters: {} });

  const groupList = groupsApi.data?.groups;
  const total = grouped ? groupList?.length : list.data?.total;
  const error = grouped ? groupsApi.error : list.error;
  const pageGroups = groupList?.slice((state.page - 1) * state.size, state.page * state.size);
  const filtered = !!state.q || Object.values(state.filters).some((v) => v.length);
  const specs = pageGroups && groupSpecs(pageGroups, {
    state, since, range, open, results, toggle: (k) => setOpen((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k])),
    showAll: ({ by, key }) => go({ group: NO_GROUP, filters: { ...state.filters, [by]: [key] } }),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sessions" icon={NAV_ICON.sessions} description={RANGE_LABEL[range]} />
      <TableToolbar
        search={{ value: state.q, onChange: (q) => go({ q }), placeholder: "Search title, id or project…", label: "Search sessions" }}
        facets={facets}
        group={{ value: state.group, options: GROUP_OPTIONS, onChange: (group) => go({ group }) }}
        view={{
          columns: columns.slice(1).filter((c) => c.hideable !== false).map((c) => ({ id: c.id, label: typeof c.header === "string" ? c.header : c.id, visible: !hidden.includes(c.id) })),
          onToggle: toggleCol, density, onDensity: setDensity,
        }}
        onReset={reset}
        summary={<span className="tabular-nums">{sessionsCountLabel(list.data?.total, !!list.error)}</span>}
      />
      <DataTable
        label="Sessions" rows={grouped ? undefined : list.data?.items} groups={grouped ? specs : undefined} columns={columns} hidden={hidden} density={density}
        rowKey={(r) => r.id} rowHref={(r) => `#${SESSIONS_PATH}/${encodeURIComponent(r.id)}`}
        sort={{ key: state.sort, dir: state.dir }} onSort={(s) => go({ sort: s.key, dir: s.dir })}
        loading={grouped ? groupsApi.loading : list.loading} stale={grouped ? groupsApi.stale : list.stale} error={error && new Error(`Couldn't load sessions. ${error.message}`)} onRetry={() => setRetry((n) => n + 1)}
        empty={filtered ? <NoMatchState noun="sessions" onReset={reset} /> : "No sessions in this range."}
      />
      {!error && <TablePagination label="Sessions" noun={grouped ? GROUP_NOUN[state.group] : "sessions"} page={state.page} pageSize={state.size} total={total ?? 0} onPage={(page) => go({ page })} onPageSize={(size) => go({ size })} />}
    </div>
  );
}
