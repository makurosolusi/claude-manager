import { useMemo, useState } from "react";
import { ScrollText, Shield } from "lucide-react";
import type { AuditResponse } from "../../server/policy.types.ts";
import type { PageProps } from "@/lib/page.props.ts";
import { NoMatchState } from "@/components/client.table.tsx";
import { DataTable } from "@/components/data.table.tsx";
import type { FacetDef } from "@/components/facet.filter.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { auditColumns, DECISION_TONE } from "@/components/policy.audit.columns.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import { useApi } from "@/lib/api.client.ts";
import { NAV_ICON, toolIcon } from "@/lib/icon.map.ts";
import { roleIcon } from "@/lib/role.icon.ts";
import { AUDIT_FACET_IDS, AUDIT_SPEC, auditApi, auditCountLabel, auditFacet, auditHref } from "@/lib/policy.audit.query.ts";
import { parseTableQuery, patchTable, type TableState } from "@/lib/table.query.ts";

const FACET_LABEL = { decision: "Decision", role: "Role", cap: "Capability", tool: "Tool" } as const;
const FACET_ICON = { decision: ScrollText, role: NAV_ICON.roles, cap: Shield, tool: toolIcon("") };

/** Policy audit: every decision the hook made; server-side search, facets and paging, state in the URL hash. */
export function PolicyAuditPage({ since, range, dataVersion, params, roles }: PageProps) {
  const state = parseTableQuery(params, AUDIT_SPEC);
  const go = (patch: Partial<TableState>) => (location.hash = auditHref(patchTable(state, patch), range));
  const [retry, setRetry] = useState(0);
  const req = auditApi(since, state, range);
  const { data, loading, stale, error } = useApi<AuditResponse>(req.path, req.query, dataVersion + retry);
  const columns = useMemo(() => auditColumns(roles), [roles]);
  const facets: FacetDef[] = AUDIT_FACET_IDS.map((id) => ({
    id, label: FACET_LABEL[id], icon: FACET_ICON[id], selected: state.filters[id] ?? [],
    options: auditFacet(data, id).map((o) => ({
      ...o, label: o.value,
      tone: id === "decision" ? DECISION_TONE[o.value] : undefined,
      icon: id === "role" ? roleIcon(o.value, roles) : id === "tool" ? toolIcon(o.value) : undefined,
    })),
    onChange: (next) => go({ filters: { ...state.filters, [id]: next } }),
  }));
  const reset = () => go({ q: "", filters: {} });
  const filtered = !!state.q || Object.values(state.filters).some((v) => v.length);

  return (
    <div className="flex flex-col gap-4">
      <a href="#/policy" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground rounded-sm outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"><span aria-hidden>‹</span>Permission policy</a>
      <PageHeader title="Policy audit" icon={ScrollText} description="Every allow, ask and deny the policy hook decided. Tool inputs, paths and commands are never recorded." />
      <TableToolbar
        search={{ value: state.q, onChange: (q) => go({ q }), placeholder: "Search role, tool or rule…", label: "Search decisions" }}
        facets={facets}
        onReset={reset}
        summary={<span className="tabular-nums">{auditCountLabel(data?.total, !!error)}</span>}
      />
      <DataTable
        label="Policy decisions" rows={data?.items} columns={columns} rowKey={(r) => r.id}
        loading={loading} stale={stale} error={error && new Error(`Couldn't load the audit. ${error.message}`)} onRetry={() => setRetry((n) => n + 1)}
        empty={filtered ? <NoMatchState noun="decisions" onReset={reset} /> : "No decisions yet. They appear here after workers run with the policy on."}
      />
      {!error && <TablePagination label="Policy decisions" noun="decisions" page={state.page} pageSize={state.size} total={data?.total ?? 0} onPage={(page) => go({ page })} onPageSize={(size) => go({ size })} />}
    </div>
  );
}
