import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Page, SessionRow, SessionSort } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import { DataTable, type Column } from "@/components/data.table.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { SessionCell } from "@/components/session.cell.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PAGE_SIZE, useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtModel, fmtProject } from "@/lib/format.ts";
import { FAMILY_COLOR, modelFamily } from "@/lib/model.tier.ts";
import type { Range } from "@/lib/range.ts";
import { SEARCH_MAX_CHARS, SESSIONS_PATH, parseSessionsQuery, sessionsHref, type SessionsState } from "@/lib/sessions.query.ts";

/** Typing pause before the search is written to the URL (and fetched). */
const SEARCH_DEBOUNCE_MS = 250;
const RANGE_LABEL: Record<Range, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

function ModelCell({ row }: { row: SessionRow }) {
  if (!row.model) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 font-mono text-xs" title={row.models > 1 ? `${row.models} models used` : row.model}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: FAMILY_COLOR[modelFamily(row.model)] }} />
      <span className="truncate">{fmtModel(row.model)}</span>
      {row.models > 1 && <span className="text-fg-subtle tabular-nums">+{row.models - 1}</span>}
    </span>
  );
}

const columns: Column<SessionRow>[] = [
  { id: "session", header: "Session", cell: (r) => <SessionCell id={r.id} title={r.title} projectCwd={r.project_cwd} /> },
  { id: "model", header: "Model", cell: (r) => <ModelCell row={r} />, width: "w-36", hideBelow: "md" },
  { id: "agents", header: "Agents", cell: (r) => (r.agents ? fmtInt(r.agents) : <span className="text-fg-subtle">—</span>), align: "right", sortKey: "agents", width: "w-16", hideBelow: "md" },
  { id: "requests", header: "Requests", cell: (r) => fmtInt(r.requests), align: "right", sortKey: "requests", width: "w-20", hideBelow: "sm" },
  { id: "tokens", header: "Tokens", cell: (r) => <TokenCell usage={r} />, align: "right", sortKey: "tokens", width: "w-20", hideBelow: "sm" },
  { id: "cost", header: "Cost (est.)", cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} />, align: "right", sortKey: "cost", width: "w-24" },
  { id: "last", header: "Last active", cell: (r) => <RelativeTime iso={r.last_ts} />, align: "right", sortKey: "last", width: "w-24" },
];

/** Sortable, searchable sessions list; all list state lives in the URL hash. */
export function SessionsPage({ since, range, dataVersion, params }: { since: string; range: Range; dataVersion: number; params: URLSearchParams }) {
  const state = parseSessionsQuery(params);
  const go = (patch: Partial<SessionsState>) => (location.hash = sessionsHref({ ...state, page: 1, ...patch }, range));
  const [draft, setDraft] = useState(state.q);
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const goLatest = useRef(go);
  goLatest.current = go; // the debounce timer must not write back a sort/page that changed while it waited

  // URL changed elsewhere (back button, Clear search): follow it unless it only differs by whitespace.
  useEffect(() => setDraft((d) => (d.trim() === state.q ? d : state.q)), [state.q]);
  useEffect(() => {
    if (draft.trim() === state.q) return;
    const t = setTimeout(() => goLatest.current({ q: draft }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);
  // A new range shrinks the result set; jump back to page 1.
  const prevRange = useRef(range);
  useEffect(() => {
    if (prevRange.current !== range && state.page > 1) go({});
    prevRange.current = range;
  }, [range]);
  // "/" focuses the search, unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const { data, error, loading } = useApi<Page<SessionRow>>(
    "/api/sessions",
    { since, project: state.project, q: state.q, sort: state.sort, dir: state.dir, page: state.page, pageSize: PAGE_SIZE },
    dataVersion + retry,
  );
  const total = data?.total ?? 0;
  const first = total ? (state.page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(state.page * PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sessions"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{data ? `${fmtInt(total)} ${total === 1 ? "session" : "sessions"}` : "Loading…"} · {RANGE_LABEL[range]}</span>
            {state.project && (
              <span className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs">
                <span className="text-fg-subtle">project:</span>
                <span className="font-mono text-foreground" title={state.project}>{fmtProject(state.project)}</span>
                <button type="button" aria-label="Remove project filter" onClick={() => go({ project: "" })} className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            )}
          </span>
        }
        actions={
          <Input
            ref={input}
            type="search"
            value={draft}
            maxLength={SEARCH_MAX_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search title, id or project…"
            aria-label="Search sessions"
            className="h-8 w-full sm:w-70"
          />
        }
      />
      <DataTable
        label="Sessions"
        rows={data?.items}
        columns={columns}
        rowKey={(r) => r.id}
        rowHref={(r) => `#${SESSIONS_PATH}/${encodeURIComponent(r.id)}`}
        sort={{ key: state.sort, dir: state.dir }}
        onSort={(s) => go({ sort: s.key as SessionSort, dir: s.dir })} // keys come from `columns`, all valid SessionSorts
        loading={loading}
        error={error && new Error(`Couldn't load sessions. ${error.message}`)}
        onRetry={() => setRetry((n) => n + 1)}
        empty={
          state.q ? (
            <span className="inline-flex flex-wrap items-center justify-center gap-2">
              No sessions match "{state.q}".
              <Button size="xs" variant="outline" onClick={() => { setDraft(""); go({ q: "" }); }}>Clear search</Button>
            </span>
          ) : (
            "No sessions in this range."
          )
        }
      />
      {data && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">Showing {fmtInt(first)}–{fmtInt(last)} of {fmtInt(total)}</span>
          <span className="flex gap-1">
            <Button size="xs" variant="ghost" disabled={state.page <= 1} onClick={() => go({ page: state.page - 1 })}>Previous</Button>
            <Button size="xs" variant="ghost" disabled={last >= total} onClick={() => go({ page: state.page + 1 })}>Next</Button>
          </span>
        </div>
      )}
    </div>
  );
}
