import type { TableState } from "./table.query.ts";

/** Subset of TableState that client tables read. */
export type ClientTableState = Omit<TableState, "group">;

export interface ClientTableOptions<T> {
  text: (r: T) => string;
  facets: Record<string, (r: T) => string>;
  sort: Record<string, (r: T) => number | string>;
  /** Facet ids whose counts tally distinct values of this key instead of rows (e.g. roles, not role × model rows). */
  unique?: Record<string, (r: T) => string>;
}

export interface ClientTableResult<T> {
  page: T[];
  total: number;
  filtered: T[];
  counts: Record<string, Map<string, number>>;
}

const cmp = (a: number | string, b: number | string) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

/** Search, faceted filter (OR within a facet, AND across), sort and slice one page; each facet's counts ignore its own selection. */
export function runClientTable<T>(rows: T[], s: ClientTableState, o: ClientTableOptions<T>): ClientTableResult<T> {
  const q = s.q.trim().toLowerCase();
  const searched = q ? rows.filter((r) => o.text(r).toLowerCase().includes(q)) : rows;
  const passes = (r: T, skip?: string) =>
    Object.entries(s.filters).every(([id, vals]) => id === skip || !vals.length || !o.facets[id] || vals.includes(o.facets[id](r)));

  const counts: Record<string, Map<string, number>> = {};
  for (const id of Object.keys(o.facets)) {
    const m = new Map<string, number>();
    const seen = new Map<string, Set<string>>();
    for (const r of searched) {
      if (!passes(r, id)) continue;
      const v = o.facets[id]!(r);
      const u = o.unique?.[id];
      if (!u) m.set(v, (m.get(v) ?? 0) + 1);
      else seen.set(v, (seen.get(v) ?? new Set()).add(u(r)));
    }
    for (const [v, s] of seen) m.set(v, s.size);
    counts[id] = m;
  }

  const filtered = searched.filter((r) => passes(r));
  const key = o.sort[s.sort];
  if (key) {
    const sign = s.dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => sign * cmp(key(a), key(b)));
  }
  const start = (Math.max(1, s.page) - 1) * s.size;
  return { page: filtered.slice(start, start + s.size), total: filtered.length, filtered, counts };
}

/** Groups rows by key, keeping first-seen group order and row order. */
export function groupBy<T>(rows: T[], key: (r: T) => string): { key: string; rows: T[] }[] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k);
    if (g) g.push(r);
    else m.set(k, [r]);
  }
  return [...m].map(([k, rs]) => ({ key: k, rows: rs }));
}
