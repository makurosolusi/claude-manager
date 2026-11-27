import type { MouseEvent, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import type { Column, DataTableProps } from "@/components/data.table.tsx";
import { GroupRows } from "@/components/group.rows.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/cn.ts";

const DEFAULT_SKELETON_ROWS = 8;
// Static strings so Tailwind's scanner sees every class.
const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" } as const;
const ROW_H = { compact: "h-9", comfortable: "h-11" } as const;

/** Alignment, width and responsive-hide classes shared by header and body cells. */
export const colClass = <T,>(c: Column<T>) => cn(c.align === "right" && "text-right tabular-nums", c.width, c.hideBelow && HIDE[c.hideBelow]);

/** Index of the column that fills the leftover width and carries the row link: the first with `primary`, else the first column. */
export const primaryIndex = <T,>(columns: Column<T>[]): number => Math.max(0, columns.findIndex((c) => c.primary));

/** Index of the column that takes the leftover width: the first with `fill`, else the primary one. */
export const fillIndex = <T,>(columns: Column<T>[]): number => {
  const i = columns.findIndex((c) => c.fill);
  return i >= 0 ? i : primaryIndex(columns);
};

const FALLBACK_ERROR = "Couldn't load this data.";

/** Splits "Couldn't load X. GET /api/x failed (500): boom" into the sentence and the technical detail; other messages get a generic sentence. */
export function splitError(message: string): { title: string; detail: string } {
  const m = /^(Couldn't [^.]*\.)\s+([\s\S]+)$/.exec(message);
  return m ? { title: m[1]!, detail: m[2]! } : { title: FALLBACK_ERROR, detail: message };
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

const go = (e: MouseEvent, href: string) => {
  if ((e.target as Element).closest("a,button,input,select,textarea")) return; // the inner control handles it
  if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
  else window.location.href = href;
};

/** The table's `<tbody>` (or one per group): skeleton, error, empty, rows, and the totals `<tfoot>`. */
export function TableBody<T>(p: DataTableProps<T> & { columns: Column<T>[] }) {
  const { rows, columns, rowKey, rowHref, density = "compact" } = p;
  const rowH = ROW_H[density];
  const span = columns.length;
  const pi = primaryIndex(columns);
  const fi = fillIndex(columns);
  const renderRow = (r: T) => {
    const href = rowHref?.(r);
    return (
      <tr key={rowKey(r)} onClick={href ? (e) => go(e, href) : undefined} className={cn("border-b hover:bg-surface-hover", rowH, href && "cursor-pointer")}>
        {columns.map((c, i) => (
          <td key={c.id} className={cn("px-3 text-[13px]", colClass(c), i === fi && "w-full max-w-0")}>
            {i === pi && href ? (
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
  };

  if (p.error) {
    const { title, detail } = splitError(p.error.message);
    return (
      <tbody>
        <StateRow span={span} alert tall>
          <span className="inline-flex flex-col items-center gap-2">
            <span className="inline-flex items-center gap-2">
              <TriangleAlert aria-hidden className="size-4 text-destructive" />
              <span className="text-foreground">{title}</span>
              {p.onRetry && <Button size="xs" variant="outline" onClick={p.onRetry}>Retry</Button>}
            </span>
            <details className="font-mono text-xs text-fg-subtle">
              <summary className="cursor-pointer">Details</summary>
              {detail}
            </details>
          </span>
        </StateRow>
      </tbody>
    );
  }
  if (p.groups) {
    return p.groups.map((g) => <GroupRows key={g.key} spec={g} columns={columns} primary={pi} fill={fi} rowH={rowH} renderRow={renderRow} cellClass={colClass} />);
  }
  if (!rows) {
    return (
      <tbody>
        {Array.from({ length: p.skeletonRows ?? DEFAULT_SKELETON_ROWS }, (_, i) => (
          <tr key={i} aria-hidden className={cn("border-b", rowH)}>
            {columns.map((c) => (
              <td key={c.id} className={cn("px-3", c.hideBelow && HIDE[c.hideBelow])}>
                <div className={cn("h-3 animate-pulse rounded-sm bg-muted", c.align === "right" ? "ml-auto w-12" : "w-3/4")} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    );
  }
  if (rows.length === 0) {
    return <tbody><StateRow span={span} tall>{p.empty ?? "Nothing here for this range."}</StateRow></tbody>;
  }
  return (
    <>
      <tbody>{rows.map(renderRow)}</tbody>
      {columns.some((c) => c.total) && (
        <tfoot>
          <tr className={cn("border-t bg-muted/40 font-medium", rowH)}>
            {columns.map((c) => (
              <td key={c.id} className={cn("px-3 text-[13px]", colClass(c))}>{c.total?.(rows)}</td>
            ))}
          </tr>
        </tfoot>
      )}
    </>
  );
}
