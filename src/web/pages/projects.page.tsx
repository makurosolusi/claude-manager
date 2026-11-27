import { useMemo, useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import type { Page, ProjectRow } from "../../server/dashboard.types.ts";
import { SESSION_STATUSES } from "../../server/dashboard.types.ts";
import { CacheText, PROJECT_HIDEABLE, projectColumns } from "@/components/projects.columns.tsx";
import { ClientTable, type ClientGrouping } from "@/components/client.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtTokens } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { FolderTree, Inbox } from "lucide-react";
import { STATUS_ICON } from "@/lib/icon.map.ts";
import { NOW_TICK_MS, useNow } from "@/lib/now.ts";
import { GROUP_PARENT, PROJECTS_FETCH_LIMIT, PROJECTS_PATH, PROJECTS_SPEC, parentOf, projectTableOptions, projectTotals } from "@/lib/projects.table.ts";
import { DEFAULT_RANGE } from "@/lib/range.ts";
import { STATUS_TONE } from "@/lib/status.level.ts";
import { runClientTable } from "@/lib/table.client.ts";
import { NO_GROUP } from "@/lib/table.query.ts";
import { facetOptions, useTableView } from "@/lib/use.table.view.ts";

const STATUS_LABEL = { live: "Live", idle: "Idle", ended: "Ended" } as const;

const grouping: ClientGrouping<ProjectRow> = {
  options: [{ value: NO_GROUP, label: "No grouping" }, { value: GROUP_PARENT, label: "Parent folder" }],
  of: (r) => {
    const parent = parentOf(r.project);
    return { key: parent, label: <span className="inline-flex items-center gap-2 font-mono text-xs"><FolderTree aria-hidden className="size-4 text-muted-foreground" />{parent}</span> };
  },
  totals: (rows) => {
    const t = projectTotals(rows);
    return { sessions: fmtInt(t.sessions), requests: fmtInt(t.requests), tokens: fmtTokens(t.tokens), cache: <CacheText ratio={t.cache} />, cost: <CostCell usd={t.cost} heat="aggregate" />, last: <RelativeTime iso={t.last} /> };
  },
};

/** Projects ranked by cost; search, status facet, parent-folder grouping and sorting run in the browser over one fetch. */
export function ProjectsPage({ since, range, dataVersion, params }: PageProps) {
  const [retry, setRetry] = useState(0);
  const view = useTableView({ id: "projects", path: PROJECTS_PATH, params, spec: PROJECTS_SPEC, hideable: PROJECT_HIDEABLE });
  const { data, error, loading } = useApi<Page<ProjectRow>>("/api/projects", { since, page: 1, pageSize: PROJECTS_FETCH_LIMIT }, dataVersion + retry);
  const now = useNow(NOW_TICK_MS);
  const { state } = view;

  const opts = useMemo(() => projectTableOptions(now), [now]);
  const result = useMemo(() => (data ? runClientTable(data.items, state, opts) : undefined), [data, opts, JSON.stringify(state)]);
  const totalCost = useMemo(() => data?.items.reduce((a, r) => a + r.cost_usd, 0) ?? 0, [data]);
  const columns = useMemo(() => projectColumns(totalCost, now), [totalCost, now]);

  const facets = [{
    id: "status",
    label: "Status",
    icon: STATUS_ICON.live,
    options: facetOptions(SESSION_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v], icon: STATUS_ICON[v], tone: STATUS_TONE[v] })), result?.counts.status),
    selected: state.filters.status ?? [],
    onChange: (next: string[]) => view.go({ filters: { ...state.filters, status: next } }),
  }];
  const total = data?.total ?? 0;
  const summary = error ? undefined : `${fmtInt(result?.filtered.length ?? 0)} of ${fmtInt(total)} projects${total > PROJECTS_FETCH_LIMIT ? ` · Top ${PROJECTS_FETCH_LIMIT} projects by cost` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Projects" description="Usage per working directory. Click a project to see its sessions." />
      <ClientTable
        label="Projects"
        noun="projects"
        empty={<span className="inline-flex flex-col items-center gap-2"><Inbox aria-hidden className="size-5" />No projects in this range.</span>}
        view={view}
        columns={columns}
        facets={facets}
        searchPlaceholder="Search project path…"
        grouping={grouping}
        result={result}
        summary={summary}
        rowKey={(r) => r.project}
        rowHref={(r) => hashHref("/sessions", { project: r.project, range: range === DEFAULT_RANGE ? undefined : range })}
        loading={loading}
        error={error && new Error(`Couldn't load projects. ${error.message}`)}
        onRetry={() => setRetry((n) => n + 1)}
      />
    </div>
  );
}
