import type { SortDir } from "@/components/data.table.tsx";

/** Rows-per-page choices offered by the UI (server cap is higher). */
export const PAGE_SIZES = [25, 50, 100] as const;
/** Default rows per page. */
export const DEFAULT_PAGE_SIZE = 50;
/** Group value meaning "not grouped". */
export const NO_GROUP = "none";
/** Max values accepted per facet and max length of each (mirrors the server limits). */
export const FACET_MAX_VALUES = 20;
export const FACET_VALUE_MAX_CHARS = 512;
/** Server rejects longer `q`; clip before it gets there. */
export const TABLE_SEARCH_MAX_CHARS = 200;

/** What a table allows in its URL: sort keys, group options and facet values ("free" = any string). */
export interface TableSpec {
  sorts: readonly string[];
  defaultSort: string;
  defaultDir: SortDir;
  groups: readonly string[]; // includes NO_GROUP
  facets: Record<string, readonly string[] | "free">;
}
/** Table state as kept in the URL hash. */
export interface TableState {
  q: string;
  sort: string;
  dir: SortDir;
  page: number;
  size: number;
  group: string;
  filters: Record<string, string[]>;
}
/** Serialised form, ready for `hashHref`/`withParams`. */
export type TableParams = Record<string, string | string[] | undefined>;

const sizeOf = (v: string | null) => (PAGE_SIZES as readonly number[]).find((n) => String(n) === v) ?? DEFAULT_PAGE_SIZE;

function facetValues(params: URLSearchParams, id: string, allowed: readonly string[] | "free"): string[] {
  const ok = (v: string) => v !== "" && v.length <= FACET_VALUE_MAX_CHARS && (allowed === "free" || allowed.includes(v));
  return [...new Set(params.getAll(id).filter(ok))].slice(0, FACET_MAX_VALUES);
}

/** Reads table state from hash params; unknown or missing values fall back to defaults, never throws. */
export function parseTableQuery(params: URLSearchParams, spec: TableSpec): TableState {
  const sort = params.get("sort") ?? "";
  const dir = params.get("dir");
  const group = params.get("group") ?? "";
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").trim().slice(0, TABLE_SEARCH_MAX_CHARS),
    sort: spec.sorts.includes(sort) ? sort : spec.defaultSort,
    dir: dir === "asc" || dir === "desc" ? dir : spec.defaultDir,
    page: Number.isInteger(page) && page > 1 ? page : 1,
    size: sizeOf(params.get("size")),
    group: spec.groups.includes(group) ? group : NO_GROUP,
    filters: Object.fromEntries(Object.entries(spec.facets).map(([id, allowed]) => [id, facetValues(params, id, allowed)])),
  };
}

/** Serialises state for the URL; values equal to the defaults are left out so links stay short. */
export function tableParams(s: TableState, spec: TableSpec): TableParams {
  const out: TableParams = {
    q: s.q.trim().slice(0, TABLE_SEARCH_MAX_CHARS) || undefined,
    sort: s.sort === spec.defaultSort ? undefined : s.sort,
    dir: s.dir === spec.defaultDir ? undefined : s.dir,
    page: s.page > 1 ? String(s.page) : undefined,
    size: s.size === DEFAULT_PAGE_SIZE ? undefined : String(s.size),
    group: s.group === NO_GROUP ? undefined : s.group,
  };
  for (const id of Object.keys(spec.facets)) out[id] = s.filters[id]?.length ? s.filters[id] : undefined;
  return out;
}

/** Applies a change to the state; anything except an explicit `page` sends the table back to page 1. */
export function patchTable(s: TableState, patch: Partial<TableState>): TableState {
  return { ...s, ...patch, page: patch.page ?? 1 };
}
