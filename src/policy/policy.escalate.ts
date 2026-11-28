import { MAIN_ROW } from "./policy.presets.ts";
import type { Capability, PolicyResult, PolicySnapshot } from "./policy.types.ts";

/** What a worker "may not" do without the owner, per capability; used in the escalation reason. */
const CAP_ACTION: Record<Capability, string> = {
  read: "read these files", edit: "edit these files", test: "run tests", shell: "run shell commands", web: "use the web",
  agents: "manage agents", git: "change git history", push: "push", mcp: "use MCP tools",
};

/**
 * Whether a worker outcome would reach the owner: every `ask`, and every `default` (Claude Code's own prompt) except
 * `read` (in-project reads don't prompt; blocking them would cripple built-in agents) and `cap === null`.
 * Limit: a tool the policy doesn't model (no capability) keeps the normal flow, so it can still prompt the owner.
 */
const reachesOwner = ({ decision, cap }: PolicyResult): boolean =>
  decision === "ask" || (decision === "default" && cap !== null && cap !== "read");

/**
 * v0.4.1 escalation step: with `snapshot.escalate`, a worker row's outcome that would prompt the owner becomes `deny`
 * telling it to report to the manager, so only the manager talks to the owner. Never applies to `main` (no `agent_id`:
 * the manager or the owner) and never produces `allow`. The reason names role and capability only; it never echoes the input.
 */
export function escalate(result: PolicyResult, snapshot: PolicySnapshot): PolicyResult {
  if (!snapshot.escalate || result.row === MAIN_ROW || !reachesOwner(result)) return result;
  const action = result.cap ? CAP_ACTION[result.cap] : "do this";
  return {
    ...result,
    decision: "deny",
    rule: `escalated:${result.rule}`,
    reason: `claude-manager policy: ${result.row} may not ${action} without the owner. Stop and report to the manager what you need and why; the manager asks the owner.`,
  };
}
