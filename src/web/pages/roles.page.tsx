import { useEffect, useState } from "react";
import type { Page, RoleRow } from "../../server/dashboard.types.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { StatusView } from "@/components/status.view.tsx";
import { Pager } from "@/components/pager.view.tsx";
import { DataTable, usageColumns, type Column } from "@/components/usage.table.tsx";
import { PAGE_SIZE, useApi } from "@/lib/api.client.ts";

const columns: Column<RoleRow>[] = [
  { head: "Role", cell: (r) => r.role },
  { head: "Model", cell: (r) => <Badge variant="secondary">{r.model}</Badge> },
  ...usageColumns<RoleRow>(),
];

/** Usage per role × model. */
export function RolesPage({ since }: { since: string }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [since]);
  const state = useApi<Page<RoleRow>>("/api/roles", { since, page, pageSize: PAGE_SIZE });
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>Roles × models</CardTitle>
      </CardHeader>
      <CardContent>
        <StatusView state={state} isEmpty={(d) => d.items.length === 0}>
          {(d) => (
            <>
              <DataTable rows={d.items} columns={columns} rowKey={(r) => `${r.role}\u0000${r.model}`} />
              <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </StatusView>
      </CardContent>
    </Card>
  );
}
