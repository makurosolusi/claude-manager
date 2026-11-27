import type { AgentNode } from "../../server/dashboard.types.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Cost } from "@/components/cost.label.tsx";
import { flattenAgentTree } from "@/lib/agent.tree.ts";
import { fmtInt, fmtTokens } from "@/lib/format.ts";

/** Pixels of indentation per spawn level. */
const INDENT_PX = 20;

/** Subagent tree, indented by parent_agent_id. */
export function AgentTree({ agents }: { agents: AgentNode[] }) {
  if (!agents.length) return <p className="text-sm text-muted-foreground">No subagents in this session.</p>;
  return (
    <ul className="flex flex-col divide-y text-sm">
      {flattenAgentTree(agents).map(({ agent: a, depth }) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2" style={{ paddingLeft: depth * INDENT_PX }}>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {depth > 0 && <span className="text-muted-foreground">└</span>}
              <span className="font-medium">{a.agent_type ?? "subagent"}</span>
              {a.models.map((m) => (
                <Badge key={m} variant="secondary">
                  {m}
                </Badge>
              ))}
            </div>
            {a.description && <span className="text-muted-foreground break-words">{a.description}</span>}
          </div>
          <div className="flex gap-3 text-muted-foreground tabular-nums">
            <span>{fmtInt(a.requests)} req</span>
            <span>
              {fmtTokens(a.input)} in / {fmtTokens(a.output)} out
            </span>
            <Cost usd={a.cost_usd} />
          </div>
        </li>
      ))}
    </ul>
  );
}
