import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Column } from "@/components/data.table.tsx";
import { cn } from "@/lib/cn.ts";
import { fmtInt } from "@/lib/format.ts";

const SKELETON_ROWS = 3;

/** One collapsible group: header label + count, subtotals per column id, its rows and an optional footer. */
export interface GroupSpec<T> {
  key: string;
  label: ReactNode;
  count: number; // rows in the WHOLE group, not one page
  totals: Partial<Record<string, ReactNode>>;
  open: boolean;
  onToggle(): void;
  rows: T[] | undefined; // undefined + open = skeleton rows
  footer?: ReactNode;
  /** Control placed right after the toggle (a sibling, so a link is valid HTML); absent = header renders as before. */
  action?: ReactNode;
}

interface GroupRowsProps<T> {
  spec: GroupSpec<T>;
  columns: Column<T>[];
  /** Index of the primary column, which holds the toggle button. */
  primary: number;
  /** Index of the column that takes the leftover width. */
  fill: number;
  rowH: string;
  renderRow: (r: T) => ReactNode;
  cellClass: (c: Column<T>) => string;
}

/** A `<tbody>` holding a group header row (button with aria-expanded) followed by its rows when open. */
export function GroupRows<T>({ spec: g, columns, primary, rowH, renderRow, cellClass, fill }: GroupRowsProps<T>) {
  const id = `${useId()}-${g.key.replace(/\W/g, "_")}`;
  const Chevron = g.open ? ChevronDown : ChevronRight;
  return (
    <tbody id={id}>
      <tr className="h-9 border-b bg-muted/40">
        {columns.map((c, i) => (
          <td key={c.id} className={cn("px-3 text-[13px]", cellClass(c), i === fill && "w-full max-w-0")}>
            {i === primary ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-expanded={g.open}
                  aria-controls={id}
                  onClick={g.onToggle}
                  className={cn("flex min-w-0 items-center gap-2 rounded-sm text-left font-medium outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring", !g.action && "w-full")}
                >
                  <span className="sr-only">Subtotal </span>
                  <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{g.label}</span>
                  <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{fmtInt(g.count)}</span>
                </button>
                {g.action}
              </div>
            ) : (
              g.totals[c.id] !== undefined && (
                <span className="font-semibold">{g.totals[c.id]}</span>
              )
            )}
          </td>
        ))}
      </tr>
      {g.open && !g.rows && Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <tr key={i} aria-hidden className={cn("border-b", rowH)}>
          {columns.map((c) => (
            <td key={c.id} className="px-3"><div className={cn("h-3 animate-pulse rounded-sm bg-muted", c.align === "right" ? "ml-auto w-12" : "w-3/4")} /></td>
          ))}
        </tr>
      ))}
      {g.open && g.rows?.map(renderRow)}
      {g.open && g.footer && (
        <tr className="border-b">
          <td colSpan={columns.length} className="h-9 px-3 pl-8 text-xs text-muted-foreground">{g.footer}</td>
        </tr>
      )}
    </tbody>
  );
}
