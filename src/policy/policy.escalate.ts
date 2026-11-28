import { MAIN_ROW } from "./policy.presets.ts";
import type { Capability, PolicyResult, PolicySnapshot } from "./policy.types.ts";

/** What a worker "may not" do without the owner, per capability; used in the escalation reason. */
const CAP_ACTION: Record<Capability, string> = {
  read: "read these files", edit: "edit these files", test: "run tests", shell: "run shell commands", web: "use the web",
  agents: "manage agents", git: "change git history", push: "push", mcp: "use MCP tools",
};

/**
 * v0.4.1 escalation step: with `snapshot.escalate`, a worker row's `ask` becomes `deny` telling it to report to the
 * manager, so only the manager talks to the owner. Never applies to `main` (no `agent_id`: the manager or the owner).
 * The reason names role and capability only; it never echoes the input.
 */
export function escalate(result: PolicyResult, snapshot: PolicySnapshot): PolicyResult {
  if (!snapshot.escalate || result.row === MAIN_ROW || result.decision !== "ask") return result;
  const action = result.cap ? CAP_ACTION[result.cap] : "do this";
  return {
    ...result,
    decision: "deny",
    rule: `escalated:${result.rule}`,
    reason: `claude-manager policy: ${result.row} may not ${action} without the owner. Stop and report to the manager what you need and why; the manager asks the owner.`,
  };
}
