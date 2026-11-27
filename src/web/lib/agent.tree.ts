import type { AgentNode } from "../../server/dashboard.types.ts";

/** One row of the flattened agent tree with its nesting depth. */
export interface TreeRow {
  agent: AgentNode;
  depth: number;
}

/** Flattens agents into depth-first display order (siblings by cost desc, ties keep input order); agents whose parent is unknown become roots. */
export function flattenAgentTree(agents: AgentNode[]): TreeRow[] {
  const ids = new Set(agents.map((a) => a.id));
  const children = new Map<string | null, AgentNode[]>();
  for (const a of agents) {
    const parent = a.parent_agent_id && ids.has(a.parent_agent_id) && a.parent_agent_id !== a.id ? a.parent_agent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), a]);
  }
  const out: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const agent of [...(children.get(parent) ?? [])].sort((a, b) => b.cost_usd - a.cost_usd)) {
      seen.add(agent.id);
      out.push({ agent, depth });
      walk(agent.id, depth + 1);
    }
  };
  walk(null, 0);
  // Each agent sits in exactly one child list, so the walk terminates; agents in a parent cycle (malformed logs) are never reached from a root and are appended flat.
  for (const agent of agents) if (!seen.has(agent.id)) out.push({ agent, depth: 0 });
  return out;
}
