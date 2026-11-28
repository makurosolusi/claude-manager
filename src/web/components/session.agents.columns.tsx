import type { AgentNode } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelDot } from "@/components/model.badge.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { fmtInt, fmtModel } from "@/lib/format.ts";
import { roleOf } from "@/lib/session.agents.ts";

/** Columns the View menu may hide (the Agent column always stays). */
export const SESSION_AGENT_HIDEABLE = [
  { id: "model", label: "Model" }, { id: "requests", label: "Requests" }, { id: "tokens", label: "Tokens" }, { id: "cost", label: "Cost" }, { id: "start", label: "Started" },
];

/** First model + "+N" for the rest; the tooltip lists them all. */
function ModelsCell({ models }: { models: string[] }) {
  if (!models.length) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap" title={models.join(", ")}>
      <ModelDot model={models[0]!} />
      <span className="truncate font-mono text-xs">{fmtModel(models[0])}</span>
      {models.length > 1 && <span className="text-xs text-muted-foreground">+{models.length - 1}</span>}
    </span>
  );
}

/** Session Agents table columns: role badge + task text, models, requests, tokens, cost and start time. */
export function sessionAgentColumns(roles: readonly RoleMeta[] | undefined): Column<AgentNode>[] {
  return [
    {
      id: "agent", header: "Agent", primary: true,
      cell: (a) => (
        <span className="flex min-w-0 items-center gap-2">
          <RoleBadge role={roleOf(a)} roles={roles} />
          <span className="min-w-0 truncate text-[13px] text-muted-foreground" title={a.description ?? undefined}>{a.description ?? "—"}</span>
        </span>
      ),
    },
    { id: "model", header: "Model", hideBelow: "md", width: "w-36", cell: (a) => <ModelsCell models={a.models} /> },
    { id: "requests", header: "Requests", align: "right", sortKey: "requests", hideBelow: "sm", width: "w-24", cell: (a) => fmtInt(a.requests) },
    { id: "tokens", header: "Tokens", align: "right", sortKey: "tokens", hideBelow: "lg", width: "w-24", cell: (a) => <TokenCell usage={a} /> },
    { id: "cost", header: "Cost (est.)", align: "right", sortKey: "cost", width: "w-24", cell: (a) => <CostCell usd={a.cost_usd} unpriced={a.unpriced} /> },
    { id: "start", header: "Started", align: "right", sortKey: "start", hideBelow: "md", width: "w-24", cell: (a) => <RelativeTime iso={a.first_ts} /> },
  ];
}
