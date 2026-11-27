import { useEffect, useState } from "react";
import type { Page, ProjectRow } from "../../server/dashboard.types.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { StatusView } from "@/components/status.view.tsx";
import { Pager } from "@/components/pager.view.tsx";
import { DataTable, usageColumns, type Column } from "@/components/usage.table.tsx";
import { PAGE_SIZE, useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtTime, shortPath } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";

const columns: Column<ProjectRow>[] = [
  { head: "Project", cell: (r) => <span title={r.project}>{shortPath(r.project)}</span> },
  { head: "Sessions", cell: (r) => fmtInt(r.sessions), className: "text-right" },
  ...usageColumns<ProjectRow>(),
  { head: "Last activity", cell: (r) => fmtTime(r.last_ts) },
];

/** Paginated projects; a row opens Sessions filtered to that project. */
export function ProjectsPage({ since }: { since: string }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [since]);
  const state = useApi<Page<ProjectRow>>("/api/projects", { since, page, pageSize: PAGE_SIZE });
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>Projects</CardTitle>
      </CardHeader>
      <CardContent>
        <StatusView state={state} isEmpty={(d) => d.items.length === 0}>
          {(d) => (
            <>
              <DataTable rows={d.items} columns={columns} rowKey={(r) => r.project} onRow={(r) => (location.hash = hashHref("/sessions", { project: r.project }))} />
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </StatusView>
      </CardContent>
    </Card>
  );
}
