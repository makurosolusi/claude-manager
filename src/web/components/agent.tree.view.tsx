import type { AgentNode } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import { ModelDot } from "@/components/model.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { flattenAgentTree } from "@/lib/agent.tree.ts";
import { fmtInt, fmtModel } from "@/lib/format.ts";

/** Pixels of indentation per spawn level. */
const INDENT_PX = 16;

/** Subagent tree (siblings by cost desc): role badge, model dots, description, requests and cost. */
export function AgentTree({ agents, roles }: { agents: AgentNode[]; roles?: readonly RoleMeta[] }) {
  if (!agents.length) return <p className="text-sm text-muted-foreground">No subagents in this session.</p>;
  return (
    <ul className="flex flex-col divide-y text-sm">
      {flattenAgentTree(agents).map(({ agent: a, depth }) => (
        <li key={a.id} className="flex flex-col gap-1 py-2" style={{ paddingLeft: depth * INDENT_PX }}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {depth > 0 && <span aria-hidden className="text-fg-subtle">└</span>}
              <RoleBadge role={a.agent_type ?? "subagent"} roles={roles} />
              {a.models.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 font-mono text-xs" title={m}>
                  <ModelDot model={m} />
                  {fmtModel(m)}
                </span>
              ))}
            </span>
            <span className="flex items-center gap-3 text-muted-foreground tabular-nums">
              <span>{fmtInt(a.requests)} req</span>
              <span className="text-foreground"><CostCell usd={a.cost_usd} unpriced={a.unpriced} /></span>
            </span>
          </div>
          {a.description && <span className="break-words text-muted-foreground">{a.description}</span>}
        </li>
      ))}
    </ul>
  );
}
