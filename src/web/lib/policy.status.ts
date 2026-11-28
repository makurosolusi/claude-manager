import type { Capability } from "../../policy/policy.types.ts";
import { CAPABILITIES } from "../../policy/policy.presets.ts";
import type { PolicyResponse, PolicyRow, PolicyStatus } from "../../server/policy.types.ts";
import { CAP_NOUN } from "./policy.matrix.ts";

export const STATUS_LABEL: Record<PolicyStatus, string> = {
  enforced: "Enforced", disabled: "Off", drift: "Drift", blocked: "Blocked", not_set_up: "Not set up",
};
export type BannerAction = "setup" | "turn_on" | "repair";
export interface Banner {
  status: PolicyStatus;
  tone: "warning" | "error" | "info";
  text: string;
  /** Primary button; null when read-only or nothing can be done from the UI. */
  cta: { label: string; action: BannerAction; href?: string } | null;
  /** Shown instead of a button in read-only mode. */
  hint?: string;
}
/** Why a `drift` policy isn't enforced, parsed from the server's free-text reasons. */
export type DriftCause = "hook_missing" | "hook_edited" | "snapshot_stale" | "other";

export const CLI_HINT = "Run: claude-manager policy apply balanced";
const trimDot = (s: string) => s.replace(/[.\s]+$/, "");

/** Best-effort cause of a drift from its first reason. */
export function driftCause(reasons: readonly string[]): DriftCause {
  const r = (reasons[0] ?? "").toLowerCase();
  if (/snapshot/.test(r)) return "snapshot_stale";
  if (/hook/.test(r) && /(edit|chang|differ|modif)/.test(r)) return "hook_edited";
  if (/hook/.test(r)) return "hook_missing";
  return "other";
}

/** Banner for `GET /api/policy` (§6.1); null while enforced or before the first load. */
export function policyBanner(p: PolicyResponse | null, readOnly: boolean): Banner | null {
  if (!p || p.status === "enforced") return null;
  const reason = p.reasons[0] ? trimDot(p.reasons[0]) : "";
  const b: Omit<Banner, "cta"> & { cta: Banner["cta"] } = (() => {
    switch (p.status) {
      case "not_set_up":
        return { status: p.status, tone: "warning" as const, cta: { label: "Set up policy", action: "setup" as const, href: "#/policy?setup=1" },
          text: "Workers will ask you for every tool. Set up a policy so the manager's team can work while push and secrets stay with you." };
      case "disabled":
        return { status: p.status, tone: "warning" as const, cta: { label: "Turn on", action: "turn_on" as const },
          text: "Policy is off. Workers ask you for every tool." };
      case "drift":
        return { status: p.status, tone: "error" as const, cta: { label: "Repair", action: "repair" as const },
          text: `Policy is set but not enforced${reason ? `: ${reason}` : ""}.` };
      default:
        return { status: p.status, tone: "info" as const, cta: null, text: reason || "Policy can't be changed here: managed settings block it." };
    }
  })();
  return readOnly && b.cta ? { ...b, cta: null, hint: CLI_HINT } : b;
}

/** Warning dot on the Agents/Policy switch while the policy isn't enforced. */
export const needsAttention = (p: PolicyResponse | null): boolean => !!p && p.status !== "enforced";

const ASK_DENY_CAPS = CAPABILITIES.filter((c) => c !== "read" && c !== "push");
const list = (row: PolicyRow, d: string, caps: readonly Capability[]) => caps.filter((c) => row.cells[c].decision === d).map((c) => CAP_NOUN[c]);

/** Escalation applies to every row but the manager's own (`main`), which still prompts the owner. */
export const isEscalated = (row: Pick<PolicyRow, "kind">, escalate: boolean | undefined): boolean => !!escalate && row.kind !== "main";

/** Agents-list column text, e.g. "Edits + tests · asks shell · push → owner"; with `escalate`, a worker's asks go "to manager". `row` undefined = not covered by the policy. */
export function effectiveLine(row: PolicyRow | undefined, status: PolicyStatus | null, escalate = false): string {
  if (status !== "enforced") return "Off";
  if (!row) return "Unknown policy";
  const allow = list(row, "allow", CAPABILITIES.filter((c) => c !== "push"));
  const shown = allow.length > 1 ? allow.filter((n) => n !== CAP_NOUN.read) : allow;
  const ask = list(row, "ask", ASK_DENY_CAPS);
  const deny = list(row, "deny", ASK_DENY_CAPS);
  const parts: string[] = [];
  if (shown.length) parts.push(shown.join(" + ").replace(/^./, (ch) => ch.toUpperCase()));
  const viaManager = isEscalated(row, escalate);
  if (ask.length) parts.push(`asks ${viaManager ? "manager for " : ""}${ask.join(", ")}`);
  if (deny.length) parts.push(`no ${deny.join(", ")}`);
  parts.push(row.cells.push.decision === "deny" ? "push denied" : viaManager ? "push → owner via manager" : "push → owner");
  return parts.join(" · ");
}
