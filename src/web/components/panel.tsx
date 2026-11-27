import type { ReactNode } from "react";
import { cn } from "@/lib/cn.ts";
import { fmtInt } from "@/lib/format.ts";

/** Titled card shared by every page section: muted 13px title, optional count and right-aligned action. */
export function Panel({ title, count, action, className, children }: { title: string; count?: number; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 [--table-bg:var(--card)]", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 tabular-nums text-fg-subtle">{fmtInt(count)}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
