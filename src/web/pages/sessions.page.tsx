import { useEffect, useState } from "react";
import type { Page, SessionRow } from "../../server/dashboard.types.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { StatusView } from "@/components/status.view.tsx";
import { Pager } from "@/components/pager.view.tsx";
import { DataTable, usageColumns, type Column } from "@/components/usage.table.tsx";
import { PAGE_SIZE, useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtTime, shortPath } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";

const columns: Column<SessionRow>[] = [
  { head: "Session", cell: (r) => <span className="block max-w-xs truncate" title={r.title ?? r.id}>{r.title ?? r.id}</span> },
  { head: "Project", cell: (r) => <span title={r.project_cwd ?? ""}>{shortPath(r.project_cwd)}</span> },
  { head: "Agents", cell: (r) => fmtInt(r.agents), className: "text-right" },
  ...usageColumns<SessionRow>(),
  { head: "Last activity", cell: (r) => fmtTime(r.last_ts) },
];

/** Paginated sessions with a project substring filter (kept in the URL hash). */
export function SessionsPage({ since, project }: { since: string; project: string }) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(project);
  useEffect(() => setDraft(project), [project]);
  useEffect(() => setPage(1), [since, project]);
  const state = useApi<Page<SessionRow>>("/api/sessions", { since, project, page, pageSize: PAGE_SIZE });
  return (
    <Card className="gap-2">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Sessions</CardTitle>
        <form
          className="w-full sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            location.hash = hashHref("/sessions", { project: draft.trim() });
          }}
        >
          <Input type="search" placeholder="Filter by project path…" aria-label="Filter by project" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
      </CardHeader>
      <CardContent>
        <StatusView state={state} isEmpty={(d) => d.items.length === 0} emptyText="No sessions match.">
          {(d) => (
            <>
              <DataTable rows={d.items} columns={columns} rowKey={(r) => r.id} onRow={(r) => (location.hash = hashHref(`/sessions/${encodeURIComponent(r.id)}`))} />
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </StatusView>
      </CardContent>
    </Card>
  );
}
