import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableBody, colClass, primaryIndex } from "@/components/data.table.body.tsx";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { cn } from "@/lib/cn.ts";

export type SortDir = "asc" | "desc";
/** Active sort: column `sortKey` + direction. */
export interface Sort { key: string; dir: SortDir }
/** One table column; numeric columns must use `align: "right"`. */
export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  sortKey?: string; // present = header becomes a sort button
  width?: string; // Tailwind width class, e.g. "w-24"; leave the primary column flexible
  /** Fills the leftover width, truncates, and carries the row link / group label; default = the first column. */
  primary?: boolean;
  /** Takes the leftover width and truncates (`w-full max-w-0`); default = the primary column. Give the primary column a `width` when another column fills. */
  fill?: boolean;
  hideBelow?: "sm" | "md" | "lg" | "2xl";
  hideable?: boolean; // default true; the primary column is never hideable
  total?: (rows: T[]) => ReactNode; // present on any column = a footer row with totals
}
export interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Row click target; the primary cell is also wrapped in `<a href>` (keyboard Enter, middle-click). */
  rowHref?: (row: T) => string;
  sort?: Sort;
  onSort?: (s: Sort) => void;
  density?: "compact" | "comfortable";
  loading?: boolean;
  /** Old data of the previous query is on screen while the new one loads: dimmed and aria-busy. */
  stale?: boolean;
  error?: Error;
  onRetry?: () => void;
  empty?: ReactNode;
  skeletonRows?: number;
  label: string;
  /** Column ids hidden via the View menu. */
  hidden?: readonly string[];
  /** When set, renders collapsible groups instead of `rows`. */
  groups?: GroupSpec<T>[];
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

/** Next sort for a header click: a new column starts descending, the active column toggles. */
export const nextSort = (cur: Sort | undefined, key: string): Sort => ({ key, dir: cur?.key === key && cur.dir === "desc" ? "asc" : "desc" });

function HeaderCell<T>({ c, sort, onSort }: { c: Column<T>; sort?: Sort; onSort?: (s: Sort) => void }) {
  const active = c.sortKey !== undefined && sort?.key === c.sortKey;
  const sortable = c.sortKey !== undefined && onSort;
  const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={sortable ? (active ? ARIA_SORT[sort!.dir] : "none") : undefined}
      // sticky only ≥sm: below that the wrapper scrolls horizontally, which would trap a sticky header.
      className={cn("z-10 h-9 border-b bg-[var(--table-bg,var(--background))] px-3 text-xs font-medium whitespace-nowrap text-muted-foreground sm:sticky sm:top-12", colClass(c), c.align !== "right" && "text-left")}
    >
      {!sortable ? c.header : (
        <button
          type="button"
          onClick={() => onSort(nextSort(sort, c.sortKey!))}
          className={cn("group/sort inline-flex items-center gap-1 rounded-sm outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring", active && "text-foreground", c.align === "right" && "flex-row-reverse")}
        >
          {c.header}
          <Icon aria-hidden className={cn("size-3", !active && "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")} />
        </button>
      )}
    </th>
  );
}

/** Columns that are shown: the primary and non-hideable columns always stay; the rest follow `hidden`. */
export const visibleColumns = <T,>(columns: Column<T>[], hidden: readonly string[] = []): Column<T>[] => {
  const p = primaryIndex(columns);
  return columns.filter((c, i) => i === p || c.hideable === false || !hidden.includes(c.id));
};

/** Full-width sortable table with loading skeleton, error + retry, empty, grouped and totals states (header always shown). */
export function DataTable<T>(p: DataTableProps<T>) {
  const columns = visibleColumns(p.columns, p.hidden);
  return (
    <div className="w-full max-sm:overflow-x-auto">
      <table aria-label={p.label} aria-busy={p.loading || p.stale || undefined} className={cn("w-full border-collapse transition-opacity", p.stale && "opacity-60")}>
        <thead>
          <tr>
            {columns.map((c) => (
              <HeaderCell key={c.id} c={c} sort={p.sort} onSort={p.onSort} />
            ))}
          </tr>
        </thead>
        <TableBody {...p} columns={columns} />
      </table>
    </div>
  );
}
