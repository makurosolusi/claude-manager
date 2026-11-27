import { useState } from "react";
import type { ColumnMenuProps } from "@/components/column.menu.tsx";
import type { FacetOption } from "@/components/facet.filter.tsx";
import { withParams } from "@/lib/hash.route.ts";
import { useViewPrefs } from "@/lib/use.view.prefs.ts";
import type { Density } from "@/lib/table.prefs.ts";
import { NO_GROUP, parseTableQuery, patchTable, tableParams, type TableSpec, type TableState } from "@/lib/table.query.ts";

/** URL-backed table state plus per-viewer view prefs and group collapse state. */
export interface TableView {
  state: TableState;
  go(patch: Partial<TableState>): void;
  reset(): void;
  hidden: string[];
  density: Density;
  closed: ReadonlySet<string>;
  toggleGroup(key: string): void;
  viewProps: ColumnMenuProps;
}

/** Hook behind every client table: parses hash params, writes patches back (keeping `range`), remembers hidden columns and density. */
export function useTableView(p: { id: string; path: string; params: URLSearchParams; spec: TableSpec; hideable: { id: string; label: string }[] }): TableView {
  const state = parseTableQuery(p.params, p.spec);
  const go = (patch: Partial<TableState>) => {
    location.hash = withParams({ path: p.path, params: p.params }, tableParams(patchTable(state, patch), p.spec));
  };
  const reset = () => go({ q: "", group: NO_GROUP, filters: Object.fromEntries(Object.keys(p.spec.facets).map((id) => [id, []])) });

  const { hidden, density, toggleCol, setDensity } = useViewPrefs(p.id);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = (key: string) => setClosed((c) => {
    const next = new Set(c);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const viewProps: ColumnMenuProps = {
    columns: p.hideable.map((c) => ({ ...c, visible: !hidden.includes(c.id) })),
    onToggle: toggleCol,
    density,
    onDensity: setDensity,
  };
  return { state, go, reset, hidden, density, closed, toggleGroup, viewProps };
}

/** Facet options with client-side counts (0 when a value has no rows). */
export function facetOptions(values: Omit<FacetOption, "count">[], counts: Map<string, number> | undefined): FacetOption[] {
  return values.map((v) => ({ ...v, count: counts?.get(v.value) ?? 0 }));
}
