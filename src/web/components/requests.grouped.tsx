import { useState, type ReactNode } from "react";
import type { GroupRow, Page } from "../../server/dashboard.types.ts";
import { STOP_NONE, type RequestGroups, type RequestRow } from "../../server/session.detail.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import { DataTable, type Column } from "@/components/data.table.tsx";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { StopReasonBadge } from "@/components/status.badge.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useApi, useApiMany, withQuery } from "@/lib/api.client.ts";
import { FAMILY_CLASSES, type RoleMeta } from "@/lib/color.tokens.ts";
import { fmtInt, fmtTokens } from "@/lib/format.ts";
import { FAMILY_ICON } from "@/lib/icon.map.ts";
import type { ModelFamily } from "@/lib/model.tier.ts";
import { requestsPath, type RequestDim } from "@/lib/requests.query.ts";
import { GROUP_PREVIEW_ROWS, type TableState } from "@/lib/table.query.ts";

function GroupLabel({ dim, value, roles }: { dim: RequestDim; value: string; roles?: readonly RoleMeta[] }) {
  if (dim === "agent") return <RoleBadge role={value} roles={roles} />;
  if (dim === "stop") return value === STOP_NONE ? <span className="text-muted-foreground">No stop reason</span> : <StopReasonBadge reason={value} />;
  const family = (Object.hasOwn(FAMILY_ICON, value) ? value : "other") as ModelFamily;
  return <ToneBadge hue={FAMILY_CLASSES[family]} icon={FAMILY_ICON[family]}>{value}</ToneBadge>;
}

const tokensOf = (g: GroupRow) => g.input + g.output + g.cache_read + g.cache_write;

interface Props {
  sessionId: string;
  state: TableState;
  go: (patch: Partial<TableState>) => void;
  columns: Column<RequestRow>[];
  hidden: readonly string[];
  density: "compact" | "comfortable";
  empty: ReactNode;
  roles?: readonly RoleMeta[];
  tick: number;
}

/** Aggregate-first grouped view: groups load collapsed with whole-session subtotals, rows are fetched on expand. Remount (key) when filters or group change. */
export function GroupedRequests({ sessionId, state, go, columns, hidden, density, empty, roles, tick }: Props) {
  const dim = state.group as RequestDim;
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const api = useApi<RequestGroups>(requestsPath(sessionId, true), { ...state.filters, q: state.q, by: dim }, retry + tick);
  const urlOf = (key: string) => withQuery(requestsPath(sessionId), { ...state.filters, q: state.q, [dim]: [key], sort: state.sort, dir: state.dir, page: 1, pageSize: GROUP_PREVIEW_ROWS });
  const previews = useApiMany<Page<RequestRow>>([...open].map(urlOf), retry + tick);
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(key)) n.add(key); return n; });
  const showAll = (key: string) => go({ group: "none", filters: { ...state.filters, [dim]: [key] } });

  const all = api.data?.groups ?? [];
  const pageGroups = all.slice((state.page - 1) * state.size, state.page * state.size);
  const specs: GroupSpec<RequestRow>[] = pageGroups.map((g) => {
    const preview = previews[urlOf(g.key)];
    return {
    key: g.key,
    label: <GroupLabel dim={dim} value={g.key} roles={roles} />,
    count: g.count,
    totals: { tokens: fmtTokens(tokensOf(g)), cost: <CostCell usd={g.cost_usd} unpriced={g.unpriced} /> },
    open: open.has(g.key),
    onToggle: () => toggle(g.key),
    rows: preview instanceof Error ? [] : preview?.items,
    footer: preview instanceof Error ? (
      <span className="inline-flex items-center gap-2 text-destructive">
        Couldn't load rows. {preview.message}
        <Button size="xs" variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry</Button>
      </span>
    ) : preview && g.count > preview.items.length ? (
      <span>
        Showing {fmtInt(preview.items.length)} of {fmtInt(g.count)} ·{" "}
        <Button size="xs" variant="link" className="px-0" onClick={() => showAll(g.key)}>Show all →</Button>
      </span>
    ) : undefined,
  };
  });
  return (
    <>
      <DataTable
        label="Requests grouped"
        rows={undefined}
        columns={columns}
        rowKey={(r) => r.message_id}
        groups={api.data && !api.error ? specs : undefined}
        hidden={hidden}
        density={density}
        loading={api.loading}
        error={api.error && new Error(`Couldn't load request groups. ${api.error.message}`)}
        onRetry={() => setRetry((n) => n + 1)}
      />
      {api.data && all.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>}
      <TablePagination label="Groups" noun="groups" page={state.page} pageSize={state.size} total={all.length} onPage={(page) => go({ page })} onPageSize={(size) => go({ size })} />
    </>
  );
}
