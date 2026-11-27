import type { RequestRow } from "../../server/session.detail.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { StopReasonBadge } from "@/components/status.badge.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import { fmtClock, splitTools } from "@/lib/detail.format.ts";
import { fmtTime, fmtTokens } from "@/lib/format.ts";
import { toolIcon } from "@/lib/icon.map.ts";
import type { RoleMeta } from "@/lib/color.tokens.ts";

/** Up to 3 tool icons (each with a `title`), then "+N" whose title lists the rest. */
function ToolsCell({ tools }: { tools: string[] }) {
  if (!tools.length) return <span className="text-fg-subtle">—</span>;
  const { shown, rest } = splitTools(tools);
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      {shown.map((name) => {
        const Icon = toolIcon(name);
        return (
          <span key={name} role="img" aria-label={name} title={name} className="inline-flex">
            <Icon aria-hidden className="size-3.5" />
          </span>
        );
      })}
      {rest.length > 0 && (
        <span title={rest.join(", ")} className="text-xs tabular-nums">
          +{rest.length}
        </span>
      )}
    </span>
  );
}

/** Columns of the requests table; below sm only Time, Agent and Cost remain. */
export const requestColumns = (roles?: readonly RoleMeta[]): Column<RequestRow>[] => [
  { id: "time", header: "Time", cell: (r) => <time dateTime={r.ts} title={fmtTime(r.ts)} className="font-mono text-xs whitespace-nowrap">{fmtClock(r.ts)}</time>, sortKey: "ts", width: "w-24" },
  { id: "agent", header: "Agent", cell: (r) => <RoleBadge role={r.role} roles={roles} />, width: "w-32" },
  { id: "model", header: "Model", cell: (r) => <ModelBadge model={r.model} />, width: "w-36", hideBelow: "sm" },
  { id: "tools", header: "Tools", cell: (r) => <ToolsCell tools={r.tools} />, width: "w-28", hideBelow: "md" },
  { id: "stop", header: "Stop", cell: (r) => <StopReasonBadge reason={r.stop_reason} />, width: "w-32", hideBelow: "md" },
  { id: "context", header: "Context", cell: (r) => fmtTokens(r.context), align: "right", sortKey: "context", width: "w-20", hideBelow: "sm" },
  { id: "tokens", header: "Tokens", cell: (r) => <TokenCell usage={r} />, align: "right", sortKey: "tokens", width: "w-20", hideBelow: "lg" },
  { id: "cost", header: "Cost (est.)", cell: (r) => <CostCell usd={r.cost_usd} />, align: "right", sortKey: "cost", width: "w-24" },
];
