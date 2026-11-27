import type { MouseEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
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
  width?: string; // Tailwind width class, e.g. "w-24"; leave the first column flexible
  hideBelow?: "sm" | "md" | "lg";
}
export interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Row click target; the first cell is also wrapped in `<a href>` (keyboard Enter, middle-click). */
  rowHref?: (row: T) => string;
  sort?: Sort;
  onSort?: (s: Sort) => void;
  density?: "compact" | "comfortable";
  loading?: boolean;
  error?: Error;
  onRetry?: () => void;
  empty?: ReactNode;
  skeletonRows?: number;
  label: string;
}

const DEFAULT_SKELETON_ROWS = 8;
// Static strings so Tailwind's scanner sees every class.
const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" } as const;
const ROW_H = { compact: "h-9", comfortable: "h-11" } as const;
const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

const colClass = <T,>(c: Column<T>) => cn(c.align === "right" && "text-right tabular-nums", c.width, c.hideBelow && HIDE[c.hideBelow]);

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
      className={cn("z-10 h-9 border-b bg-background px-3 text-xs font-medium whitespace-nowrap text-muted-foreground sm:sticky sm:top-12", colClass(c), c.align !== "right" && "text-left")}
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

function StateRow({ span, children, alert, tall }: { span: number; children: ReactNode; alert?: boolean; tall?: boolean }) {
  return (
    <tr>
      <td colSpan={span} role={alert ? "alert" : undefined} className={cn("px-3 text-center text-muted-foreground", tall ? "h-30" : "h-12")}>
        {children}
      </td>
    </tr>
  );
}

/** Full-width sortable table with built-in loading skeleton, error + retry, and empty states (header always shown). */
export function DataTable<T>(p: DataTableProps<T>) {
  const { rows, columns, rowKey, rowHref, density = "compact", loading, error, label } = p;
  const [span, rowH] = [columns.length, ROW_H[density]];
  const go = (e: MouseEvent, href: string) => {
    if ((e.target as Element).closest("a,button,input,select,textarea")) return; // the inner control handles it
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
    else window.location.href = href;
  };

  let body: ReactNode;
  if (error) {
    body = (
      <StateRow span={span} alert>
        <span className="inline-flex items-center gap-2">
          <TriangleAlert aria-hidden className="size-4 text-destructive" />
          <span className="text-foreground">{error.message}</span>
          {p.onRetry && <Button size="xs" variant="outline" onClick={p.onRetry}>Retry</Button>}
        </span>
      </StateRow>
    );
  } else if (!rows) {
    body = Array.from({ length: p.skeletonRows ?? DEFAULT_SKELETON_ROWS }, (_, i) => (
      <tr key={i} aria-hidden className={cn("border-b", rowH)}>
        {columns.map((c) => (
          <td key={c.id} className={cn("px-3", c.hideBelow && HIDE[c.hideBelow])}>
            <div className={cn("h-3 animate-pulse rounded-sm bg-muted", c.align === "right" ? "ml-auto w-12" : "w-3/4")} />
          </td>
        ))}
      </tr>
    ));
  } else if (rows.length === 0) {
    body = <StateRow span={span} tall>{p.empty ?? "Nothing here for this range."}</StateRow>;
  } else {
    body = rows.map((r) => {
      const href = rowHref?.(r);
      return (
        <tr key={rowKey(r)} onClick={href ? (e) => go(e, href) : undefined} className={cn("border-b hover:bg-surface-hover", rowH, href && "cursor-pointer")}>
          {columns.map((c, i) => (
            <td key={c.id} className={cn("px-3 text-[13px]", colClass(c), i === 0 && "max-w-0")}>
              {i === 0 && href ? (
                <a href={href} className="block min-w-0 truncate rounded-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
                  {c.cell(r)}
                </a>
              ) : (
                c.cell(r)
              )}
            </td>
          ))}
        </tr>
      );
    });
  }

  return (
    <div className="w-full max-sm:overflow-x-auto">
      <table aria-label={label} aria-busy={loading || undefined} className={cn("w-full border-collapse", loading && rows && "opacity-60 transition-opacity")}>
        <thead>
          <tr>
            {columns.map((c) => (
              <HeaderCell key={c.id} c={c} sort={p.sort} onSort={p.onSort} />
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
