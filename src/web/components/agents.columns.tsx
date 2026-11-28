import type { AgentRow } from "../../server/agents.types.ts";
import { DisabledChip, KindCell, ScopeCell, ToolsCell } from "@/components/agent.cells.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelChain } from "@/components/model.chain.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { TONE_CLASSES, type RoleMeta } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { chainText } from "@/lib/agents.table.ts";
import { fmtInt } from "@/lib/format.ts";
import type { Tiers } from "@/lib/model.tier.ts";

/** Columns the View menu may hide (the Agent column always stays). */
export const AGENT_HIDEABLE = [
  { id: "description", label: "When to use" }, { id: "model", label: "Model" }, { id: "tools", label: "Tools" }, { id: "scope", label: "Scope" },
  { id: "kind", label: "Kind" }, { id: "requests", label: "Requests" }, { id: "cost", label: "Cost" }, { id: "last", label: "Last used" }, { id: "rerouted", label: "Rerouted" },
];

/** Rerouted share as a percentage; warning tone when above zero. */
function Rerouted({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-fg-subtle">—</span>;
  return <span className={cn("tabular-nums", pct > 0 ? TONE_CLASSES.warning.text : "text-fg-subtle")}>{pct > 0 ? `${pct.toFixed(1)}%` : "—"}</span>;
}

/** Model column: alias only below md, `tier → alias` up to 2xl (the model ID stays in the tooltip), the full chain beyond. */
function ModelCell({ row, tiers }: { row: AgentRow; tiers: Tiers | undefined }) {
  return (
    <span title={chainText(row)} className="block min-w-0">
      <ModelChain row={row} tiers={tiers} compact className="md:hidden" />
      <ModelChain row={{ ...row, model_id: null }} tiers={tiers} className="max-md:hidden 2xl:hidden" />
      <ModelChain row={row} tiers={tiers} className="max-2xl:hidden" />
    </span>
  );
}

/** Agents table columns. `rerouted` drops the Rerouted column when no agent has data for it. */
export function agentColumns(roles: readonly RoleMeta[] | undefined, tiers: Tiers | undefined, rerouted: boolean): Column<AgentRow>[] {
  const cols: Column<AgentRow>[] = [
    {
      id: "agent", header: "Agent", primary: true, sortKey: "name", width: "w-44",
      cell: (r) => (
        <span className={cn("flex min-w-0 items-center gap-2", r.status === "disabled" && "opacity-60")}>
          <RoleBadge role={r.name} roles={roles} />
          {r.status === "disabled" && <DisabledChip />}
        </span>
      ),
    },
    { id: "description", header: "When to use", fill: true, hideBelow: "md", width: "min-w-48", cell: (r) => <span title={r.description ?? undefined} className="block truncate text-[13px] text-muted-foreground">{r.description ?? "—"}</span> },
    { id: "model", header: "Model", width: "w-24 md:w-44 2xl:w-72", cell: (r) => <ModelCell row={r} tiers={tiers} /> },
    { id: "tools", header: "Tools", hideBelow: "lg", width: "w-24", cell: (r) => <ToolsCell row={r} /> },
    { id: "scope", header: "Scope", hideBelow: "lg", width: "w-24", cell: (r) => <ScopeCell scopes={r.scopes} /> },
    { id: "kind", header: "Kind", width: "w-24 sm:w-28", cell: (r) => <KindCell kind={r.kind} /> },
    { id: "requests", header: "Requests (30d)", align: "right", sortKey: "requests", hideBelow: "sm", width: "w-24", cell: (r) => fmtInt(r.usage.requests) },
    { id: "cost", header: "Cost (est.)", align: "right", sortKey: "cost", hideBelow: "md", width: "w-24", cell: (r) => <CostCell usd={r.usage.cost_usd} unpriced={r.usage.unpriced} /> },
    { id: "last", header: "Last used", align: "right", sortKey: "last", hideBelow: "md", width: "w-20", cell: (r) => <RelativeTime iso={r.usage.last_ts} /> },
  ];
  if (rerouted) cols.push({ id: "rerouted", header: "Rerouted", align: "right", hideBelow: "lg", width: "w-20", cell: (r) => <Rerouted pct={r.usage.rerouted_pct} /> });
  return cols;
}
