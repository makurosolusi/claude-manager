import { useMemo, useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import type { Page, ProjectRow } from "../../server/dashboard.types.ts";
import { PROJECT_KINDS } from "../../server/project.path.ts";
import { SESSION_STATUSES } from "../../server/dashboard.types.ts";
import { PROJECT_HIDEABLE, projectColumns } from "@/components/projects.columns.tsx";
import { ClientTable } from "@/components/client.table.tsx";
import { RANGE_LABEL } from "@/pages/sessions.page.tsx";
import { Inbox } from "lucide-react";
import { ProjectCell } from "@/components/project.cells.tsx";
import { projectGrouping } from "@/components/project.groups.tsx";
import { KIND_META } from "@/components/project.cells.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { NAV_ICON, STATUS_ICON } from "@/lib/icon.map.ts";
import { NOW_TICK_MS, useNow } from "@/lib/now.ts";
import { groupFromUrl, groupToUrl, orderBuckets, orderGroups, PROJECTS_FETCH_LIMIT, PROJECTS_PATH, PROJECTS_SPEC, projectTableOptions } from "@/lib/projects.table.ts";
import { DEFAULT_RANGE } from "@/lib/range.ts";
import { STATUS_TONE } from "@/lib/status.level.ts";
import { NO_GROUP } from "@/lib/table.query.ts";
import { runClientTable } from "@/lib/table.client.ts";
import { facetOptions, useTableView } from "@/lib/use.table.view.ts";

const STATUS_LABEL = { live: "Live", idle: "Idle", ended: "Ended" } as const;

/** Projects ranked by cost; search, status and kind facets, folder/kind grouping and sorting run in the browser over one fetch. */
export function ProjectsPage({ since, range, dataVersion, params }: PageProps) {
  const [retry, setRetry] = useState(0);
  const view = useTableView({ id: "projects", path: PROJECTS_PATH, params, spec: PROJECTS_SPEC, hideable: PROJECT_HIDEABLE });
  const { data, error, loading, stale } = useApi<Page<ProjectRow>>("/api/projects", { since, range, page: 1, pageSize: PROJECTS_FETCH_LIMIT }, dataVersion + retry);
  const now = useNow(NOW_TICK_MS);
  const mode = groupFromUrl(view.state.group);
  // ClientTable only knows NO_GROUP = flat, so hand it the resolved grouping and map its group changes back to URL values.
  const tableView = useMemo(
    () => ({ ...view, state: { ...view.state, group: mode === "none" ? NO_GROUP : mode }, go: (p: Parameters<typeof view.go>[0]) => view.go(p.group === undefined ? p : { ...p, group: groupToUrl(p.group) }) }),
    [view, mode],
  );
  const { state } = view;

  const opts = useMemo(() => projectTableOptions(now), [now]);
  const result = useMemo(() => {
    const r = data ? runClientTable(data.items, state, opts) : undefined;
    if (!r || mode === "none") return r;
    return { ...r, filtered: mode === "kind" ? orderGroups(r.filtered, (p) => p.kind) : orderBuckets(r.filtered) }; // groups run by total cost
  }, [data, opts, mode, JSON.stringify(state)]);
  const grouping = useMemo(() => projectGrouping(mode), [mode]);
  const totalCost = useMemo(() => data?.items.reduce((a, r) => a + r.cost_usd, 0) ?? 0, [data]);
  // In Kind grouping the group header already names the kind, so the row drops its own badge.
  const columns = useMemo(
    () => projectColumns(totalCost, now).map((c) => (c.id === "project" ? { ...c, cell: (r: ProjectRow) => <ProjectCell r={r} hideKind={mode === "kind"} /> } : c)),
    [totalCost, now, mode],
  );

  const facets = [{
    id: "status",
    label: "Status",
    icon: STATUS_ICON.live,
    options: facetOptions(SESSION_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v], icon: STATUS_ICON[v], tone: STATUS_TONE[v] })), result?.counts.status),
    selected: state.filters.status ?? [],
    onChange: (next: string[]) => view.go({ filters: { ...state.filters, status: next } }),
  }, {
    id: "kind",
    label: "Kind",
    icon: NAV_ICON.projects,
    options: facetOptions(PROJECT_KINDS.map((v) => ({ value: v, label: KIND_META[v].label, icon: KIND_META[v].icon, tone: KIND_META[v].tone })), result?.counts.kind),
    selected: state.filters.kind ?? [],
    onChange: (next: string[]) => view.go({ filters: { ...state.filters, kind: next } }),
  }];
  const total = data?.total ?? 0;
  const summary = error ? undefined : `${fmtInt(result?.filtered.length ?? 0)} of ${fmtInt(total)} projects${total > PROJECTS_FETCH_LIMIT ? ` · Top ${PROJECTS_FETCH_LIMIT} projects by cost` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Projects" icon={NAV_ICON.projects} description={RANGE_LABEL[range]} />
      <ClientTable
        label="Projects"
        noun="projects"
        empty={<span className="inline-flex flex-col items-center gap-2"><Inbox aria-hidden className="size-5" />No projects in this range.</span>}
        view={tableView}
        columns={columns}
        facets={facets}
        searchPlaceholder="Search name or path…"
        grouping={grouping}
        result={result}
        summary={summary}
        rowKey={(r) => r.project}
        rowHref={(r) => hashHref("/sessions", { project: r.project, range: range === DEFAULT_RANGE ? undefined : range })}
        loading={loading}
        stale={stale}
        error={error && new Error(`Couldn't load projects. ${error.message}`)}
        onRetry={() => setRetry((n) => n + 1)}
      />
    </div>
  );
}
