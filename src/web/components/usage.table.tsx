import type { ReactNode } from "react";
import type { Usage } from "../../server/dashboard.types.ts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { Cost } from "@/components/cost.label.tsx";
import { fmtInt, fmtTokens } from "@/lib/format.ts";

export interface Column<T> {
  head: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** Token/cost columns shared by every usage table. */
export function usageColumns<T extends Usage>(): Column<T>[] {
  return [
    { head: "Requests", cell: (r) => fmtInt(r.requests), className: "text-right" },
    { head: "Input", cell: (r) => fmtTokens(r.input), className: "text-right" },
    { head: "Output", cell: (r) => fmtTokens(r.output), className: "text-right" },
    { head: "Cache write", cell: (r) => fmtTokens(r.cache_write), className: "text-right" },
    { head: "Cache read", cell: (r) => fmtTokens(r.cache_read), className: "text-right" },
    { head: "Cost", cell: (r) => <Cost usd={r.cost_usd} />, className: "text-right" },
  ];
}

/** Table of rows with custom leading columns; clickable rows when `onRow` is given. */
export function DataTable<T>({ rows, columns, rowKey, onRow }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.head} className={c.className}>
              {c.head}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow
            key={rowKey(r)}
            className={onRow ? "cursor-pointer" : undefined}
            tabIndex={onRow ? 0 : undefined}
            onClick={onRow && (() => onRow(r))}
            onKeyDown={onRow && ((e) => e.key === "Enter" && onRow(r))}
          >
            {columns.map((c) => (
              <TableCell key={c.head} className={c.className}>
                {c.cell(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
