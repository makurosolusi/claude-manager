import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/data.table.tsx";
import type { FacetDef } from "@/components/facet.filter.tsx";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { TableToolbar } from "@/components/table.toolbar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { UI_ICON } from "@/lib/icon.map.ts";
import { groupBy } from "@/lib/table.client.ts";
import { NO_GROUP } from "@/lib/table.query.ts";
import type { TableView } from "@/lib/use.table.view.ts";

/** Grouping rule of a client table: which group a row falls in and the subtotals shown on the group header. */
export interface ClientGrouping<T> {
  options: { value: string; label: string }[];
  of: (r: T) => { key: string; label: ReactNode };
  totals: (rows: T[]) => GroupSpec<T>["totals"];
}

interface ClientTableProps<T> {
  label: string;
  noun: string; // plural, for "No <noun> match these filters."
  empty: ReactNode; // shown when there is no data at all
  view: TableView;
  columns: Column<T>[];
  facets: FacetDef[];
  searchPlaceholder: string;
  grouping: ClientGrouping<T>;
  result: { filtered: T[]; page: T[] } | undefined;
  summary?: ReactNode;
  rowKey: (r: T) => string;
  rowHref: (r: T) => string;
  sort?: { key: string; dir: "asc" | "desc" };
  loading: boolean;
  error?: Error;
  onRetry: () => void;
}

/** Toolbar + DataTable + pagination for a table that sorts, filters, groups and pages in the browser. */
export function ClientTable<T>(p: ClientTableProps<T>) {
  const { view, result } = p;
  const { state } = view;
  const grouped = state.group !== NO_GROUP && !!result?.filtered.length;
  const groups: GroupSpec<T>[] | undefined = grouped
    ? groupBy(result.filtered, (r) => p.grouping.of(r).key).map((g) => ({
        key: g.key,
        label: p.grouping.of(g.rows[0]!).label,
        count: g.rows.length,
        totals: p.grouping.totals(g.rows),
        open: !view.closed.has(g.key),
        onToggle: () => view.toggleGroup(g.key),
        rows: g.rows,
      }))
    : undefined;
  const filtering = state.q !== "" || Object.values(state.filters).some((v) => v.length);
  const NoMatch = UI_ICON.noMatch;
  const empty = filtering ? (
    <span className="inline-flex flex-col items-center gap-2">
      <NoMatch aria-hidden className="size-5" />
      No {p.noun} match these filters.
      <Button size="xs" variant="outline" onClick={view.reset}>Reset filters</Button>
    </span>
  ) : p.empty;

  return (
    <div className="flex flex-col gap-3">
      <TableToolbar
        search={{ value: state.q, onChange: (q) => view.go({ q }), placeholder: p.searchPlaceholder, label: `Search ${p.noun}` }}
        facets={p.facets}
        group={{ value: state.group, options: p.grouping.options, onChange: (group) => view.go({ group }) }}
        view={view.viewProps}
        onReset={view.reset}
        summary={p.summary}
      />
      <DataTable
        label={p.label}
        rows={p.error ? undefined : result?.page}
        groups={groups}
        columns={p.columns}
        rowKey={p.rowKey}
        rowHref={p.rowHref}
        sort={p.sort ?? { key: state.sort, dir: state.dir }}
        onSort={(s) => view.go({ sort: s.key, dir: s.dir })}
        density={view.density}
        hidden={view.hidden}
        loading={p.loading}
        error={p.error}
        onRetry={p.onRetry}
        empty={empty}
      />
      {result && !p.error && !grouped && (
        <TablePagination
          label={p.label}
          page={state.page}
          pageSize={state.size}
          total={result.filtered.length}
          onPage={(page) => view.go({ page })}
          onPageSize={(size) => view.go({ size })}
        />
      )}
    </div>
  );
}
