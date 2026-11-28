import type { AgentRow } from "../../server/agents.types.ts";
import { ToolsCell } from "@/components/agent.cells.tsx";
import { AgentNameCell } from "@/components/agent.name.cell.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelChain } from "@/components/model.chain.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { TONE_CLASSES, type RoleMeta } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { chainText } from "@/lib/agents.table.ts";
import { fmtInt } from "@/lib/format.ts";
import { REROUTE_COLUMN_NOTE, agentRerouteNote } from "@/lib/reroute.ts";
import type { Tiers } from "@/lib/model.tier.ts";
import { cellsTitle, rowForAgent } from "@/lib/policy.use.ts";
import { effectiveLine } from "@/lib/policy.status.ts";
import type { PolicyResponse } from "../../server/policy.types.ts";

/** Columns the View menu may hide (the Agent column always stays). */
export const AGENT_HIDEABLE = [
  { id: "description", label: "When to use" }, { id: "model", label: "Model" }, { id: "tools", label: "Tools" }, { id: "permission", label: "Effective permission" },
  { id: "requests", label: "Requests" }, { id: "cost", label: "Cost" }, { id: "last", label: "Last used" }, { id: "rerouted", label: "Rerouted" },
];

/** Rerouted share: muted tabular percentage and a small warning dot; the title explains. */
function Rerouted({ row }: { row: AgentRow }) {
  const pct = row.usage.rerouted_pct;
  if (!pct) return <span className="text-fg-subtle">—</span>;
  return (
    <span title={agentRerouteNote(pct, row.usage.requests)} className="inline-flex items-center justify-end gap-1.5 text-muted-foreground tabular-nums">
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_CLASSES.warning.dot)} />{`${Math.round(pct)}%`}
    </span>
  );
}

/** Model column: alias only below md; from md `[tier icon] alias  model-id`. */
function ModelCell({ row, tiers }: { row: AgentRow; tiers: Tiers | undefined }) {
  return (
    <span title={chainText(row)} className="block min-w-0">
      <ModelChain row={row} tiers={tiers} compact className="md:hidden" />
      <ModelChain row={row} tiers={tiers} tierIcon className="max-md:hidden" />
    </span>
  );
}

/** Effective permission one-liner; "—" until the policy has loaded, the title lists all 9 cells. */
function PermissionCell({ row, policy }: { row: AgentRow; policy: PolicyResponse | undefined }) {
  if (!policy) return <span className="text-fg-subtle">—</span>;
  const pr = rowForAgent(policy.rows, row);
  const off = policy.status !== "enforced";
  return <span title={pr ? cellsTitle(pr) : undefined} className={cn("line-clamp-2 whitespace-normal text-[13px]", off ? "text-fg-subtle" : "text-muted-foreground")}>{effectiveLine(pr, policy.status)}</span>;
}

/** Agents table columns. `rerouted` adds the Rerouted column (only when some agent was rerouted); `showMain` adds the Main chip (off when grouped by level); `policy` fills the Effective permission column. */
export function agentColumns(roles: readonly RoleMeta[] | undefined, tiers: Tiers | undefined, rerouted: boolean, showMain: boolean, policy?: PolicyResponse): Column<AgentRow>[] {
  const cols: Column<AgentRow>[] = [
    {
      id: "agent", header: "Agent", primary: true, sortKey: "name", width: "w-56 max-w-56",
      cell: (r) => (
        <span className="block min-w-0">
          <AgentNameCell row={r} roles={roles} showMain={showMain} />
          {r.description && <span className="mt-0.5 line-clamp-1 whitespace-normal text-xs text-muted-foreground md:hidden">{r.description}</span>}
        </span>
      ),
    },
    { id: "description", header: "When to use", fill: true, hideBelow: "md", width: "min-w-48", cell: (r) => <span title={r.description ?? undefined} className="line-clamp-2 whitespace-normal text-[13px] text-muted-foreground">{r.description ?? "—"}</span> },
    { id: "model", header: "Model", width: "w-24 md:w-56 2xl:w-72", cell: (r) => <ModelCell row={r} tiers={tiers} /> },
    { id: "tools", header: "Tools", hideBelow: "lg", width: "w-40", cell: (r) => <ToolsCell row={r} /> },
    { id: "permission", header: "Effective permission", hideBelow: "2xl", width: "w-56", cell: (r) => <PermissionCell row={r} policy={policy} /> },
    { id: "requests", header: "Requests (30d)", align: "right", sortKey: "requests", hideBelow: "sm", width: "w-24", cell: (r) => fmtInt(r.usage.requests) },
    { id: "cost", header: "Cost (est.)", align: "right", sortKey: "cost", hideBelow: "md", width: "w-24", cell: (r) => <CostCell usd={r.usage.cost_usd} unpriced={r.usage.unpriced} /> },
    { id: "last", header: "Last used", align: "right", sortKey: "last", hideBelow: "md", width: "w-20", cell: (r) => <RelativeTime iso={r.usage.last_ts} /> },
  ];
  if (rerouted) cols.push({ id: "rerouted", header: <span title={REROUTE_COLUMN_NOTE}>Rerouted</span>, align: "right", hideBelow: "lg", width: "w-20", cell: (r) => <Rerouted row={r} /> });
  return cols;
}
