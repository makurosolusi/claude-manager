import { useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/cn.ts";
import { fmtInt } from "@/lib/format.ts";
import { PAGE_SIZES } from "@/lib/table.query.ts";

/** Page numbers to show: first, last, current±1, with `"gap"` where numbers are skipped. */
export function pageWindow(page: number, last: number): (number | "gap")[] {
  const keep = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  return keep.flatMap((n, i) => (i > 0 && n - keep[i - 1]! > 1 ? ["gap" as const, n] : [n]));
}

// 44px tap target below sm, 32px from sm up.
const BTN = "max-sm:size-11";

/** "Showing x–y of z", page buttons and a rows-per-page select; always shown when total > 0. */
export function TablePagination(p: { page: number; pageSize: number; total: number; onPage(n: number): void; onPageSize(n: number): void; sizes?: readonly number[]; label: string }) {
  const last = Math.max(1, Math.ceil(p.total / p.pageSize));
  const page = Math.min(p.page, last);
  useEffect(() => {
    if (p.total > 0 && p.page > last) p.onPage(last); // data shrank under the current page
  }, [p.total, p.page, last]);
  if (p.total <= 0) return null;
  const from = (page - 1) * p.pageSize + 1;
  const to = Math.min(page * p.pageSize, p.total);
  const go = (n: number, label: string, Icon: typeof ChevronLeft, off: boolean) => (
    <Button variant="outline" size="icon-sm" className={BTN} aria-label={label} disabled={off} onClick={() => p.onPage(n)}>
      <Icon aria-hidden />
    </Button>
  );
  return (
    <nav aria-label={`${p.label} pagination`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3 text-sm text-muted-foreground">
      <span className="tabular-nums">Showing {fmtInt(from)}–{fmtInt(to)} of {fmtInt(p.total)}</span>
      <div className="flex items-center gap-1">
        {go(1, "First page", ChevronsLeft, page <= 1)}
        {go(page - 1, "Previous page", ChevronLeft, page <= 1)}
        <span className="px-2 tabular-nums sm:hidden">Page {page} of {last}</span>
        <ol className="flex items-center gap-1 max-sm:hidden">
          {pageWindow(page, last).map((n, i) => (
            <li key={n === "gap" ? `gap${i}` : n}>
              {n === "gap" ? (
                <Ellipsis aria-hidden className="mx-1 size-4" />
              ) : (
                <Button
                  variant={n === page ? "default" : "ghost"}
                  size="icon-sm"
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  className={cn("tabular-nums", n === page && "pointer-events-none")}
                  onClick={() => p.onPage(n)}
                >
                  {n}
                </Button>
              )}
            </li>
          ))}
        </ol>
        {go(page + 1, "Next page", ChevronRight, page >= last)}
        {go(last, "Last page", ChevronsRight, page >= last)}
      </div>
      <label className="flex items-center gap-2">
        Rows per page
        <select
          value={p.pageSize}
          onChange={(e) => p.onPageSize(Number(e.target.value))}
          className="h-8 rounded-md border bg-background px-2 text-foreground outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {(p.sizes ?? PAGE_SIZES).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}
