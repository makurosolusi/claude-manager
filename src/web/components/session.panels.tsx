import type { ReactNode } from "react";
import { Panel } from "@/components/panel.tsx";
import type { ToolCount } from "../../server/session.detail.types.ts";
import type { UsageRow } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { byRole } from "@/lib/session.agents.ts";
import type { AgentNode } from "../../server/dashboard.types.ts";
import { cn } from "@/lib/cn.ts";
import { fmtInt, plural } from "@/lib/format.ts";
import { toolIcon } from "@/lib/icon.map.ts";

/** List height of every summary panel before it scrolls; keeps the summary row under ~18rem. */
const SUMMARY_MAX_HEIGHT = "max-h-52";
const LIST = cn("flex flex-col divide-y overflow-y-auto text-sm", SUMMARY_MAX_HEIGHT);

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

/** Models used in the session: family dot + id, requests and cost (server order: cost desc). */
export function ModelsPanel({ models }: { models: UsageRow[] }) {
  return (
    <Panel title="Models" count={models.length}>
      {models.length === 0 ? <Empty>No model usage yet.</Empty> : (
        <ul className={LIST}>
          {models.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 py-1.5">
              <ModelBadge model={m.key} />
              <span className="flex shrink-0 items-center gap-3 text-muted-foreground tabular-nums">
                <span>{plural(m.requests, "request")}</span>
                <span className="text-foreground"><CostCell usd={m.cost_usd} unpriced={m.unpriced} /></span>
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
        <ul className={LIST}>
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

/** Subagent runs rolled up per role: badge, requests and cost (most expensive first). */
export function RolesPanel({ agents, roles }: { agents: AgentNode[]; roles?: readonly RoleMeta[] }) {
  const rows = byRole(agents);
  return (
    <Panel title="By role" count={rows.length}>
      {rows.length === 0 ? <Empty>No subagents in this session.</Empty> : (
        <ul className={LIST}>
          {rows.map((r) => (
            <li key={r.role} className="flex items-center justify-between gap-3 py-1.5">
              <RoleBadge role={r.role} roles={roles} />
              <span className="flex shrink-0 items-center gap-3 text-muted-foreground tabular-nums">
                <span>{plural(r.requests, "request")}</span>
                <span className="text-foreground"><CostCell usd={r.cost_usd} unpriced={r.unpriced} /></span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
