import type { ReactNode } from "react";
import type { ToolCount } from "../../server/session.detail.types.ts";
import type { UsageRow } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { cn } from "@/lib/cn.ts";
import { fmtInt } from "@/lib/format.ts";
import { toolIcon } from "@/lib/icon.map.ts";

/** Tools listed before the panel scrolls. */
const TOOLS_MAX_HEIGHT = "max-h-72";

/** Titled card used by every side panel and the main sections. */
export function Panel({ title, count, className, children }: { title: string; count?: number; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4", className)}>
      <h2 className="text-[13px] font-medium text-muted-foreground">
        {title}
        {count !== undefined && <span className="ml-1.5 tabular-nums text-fg-subtle">{fmtInt(count)}</span>}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

/** Models used in the session: family dot + id, requests and cost (server order: cost desc). */
export function ModelsPanel({ models }: { models: UsageRow[] }) {
  return (
    <Panel title="Models" count={models.length}>
      {models.length === 0 ? <Empty>No model usage yet.</Empty> : (
        <ul className="flex flex-col divide-y text-sm">
          {models.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 py-1.5">
              <ModelBadge model={m.key} />
              <span className="flex shrink-0 items-center gap-3 text-muted-foreground tabular-nums">
                <span>{fmtInt(m.requests)} req</span>
                <span className="text-foreground"><CostCell usd={m.cost_usd} unpriced={m.unpriced} heat="aggregate" /></span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Tools called in the session with icon, name and call count (server order: most used first). */
export function ToolsPanel({ tools }: { tools: ToolCount[] }) {
  return (
    <Panel title="Tools used" count={tools.length}>
      {tools.length === 0 ? <Empty>No tool calls.</Empty> : (
        <ul className={cn("flex flex-col divide-y overflow-y-auto text-sm", TOOLS_MAX_HEIGHT)}>
          {tools.map((t) => {
            const Icon = toolIcon(t.name);
            return (
              <li key={t.name} className="flex items-center justify-between gap-3 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs" title={t.name}>{t.name}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">{fmtInt(t.calls)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
