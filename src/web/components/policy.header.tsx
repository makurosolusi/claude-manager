import { Lock, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ReadOnlyBadge } from "@/components/agent.readonly.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { cn } from "@/lib/cn.ts";
import type { ToneKey } from "@/lib/color.tokens.ts";
import { STATUS_LABEL } from "@/lib/policy.status.ts";
import type { PolicyStatus } from "../../server/policy.types.ts";

const CHIP: Record<PolicyStatus, [ToneKey, LucideIcon]> = {
  enforced: ["success", ShieldCheck], disabled: ["neutral", ShieldOff], drift: ["danger", ShieldAlert], blocked: ["info", Lock], not_set_up: ["warning", ShieldAlert],
};

export const StatusChip = ({ status }: { status: PolicyStatus }) => <ToneBadge tone={CHIP[status][0]} icon={CHIP[status][1]}>{STATUS_LABEL[status]}</ToneBadge>;

interface Props { status: PolicyStatus; enabled: boolean; canSwitch: boolean; readOnly: boolean; busy: boolean; onToggle: () => void }

/** Right side of the page header: status chip, read-only badge or the Enforce switch, link to the audit view. */
export function PolicyActions({ status, enabled, canSwitch, readOnly, busy, onToggle }: Props) {
  return (
    <>
      <StatusChip status={status} />
      {readOnly && <ReadOnlyBadge />}
      {canSwitch && (
        <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
          Enforce
          <button
            type="button" role="switch" aria-checked={enabled} disabled={busy || status === "blocked"} onClick={onToggle}
            className={cn("relative h-5 w-9 rounded-full border outline-hidden transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring disabled:opacity-50", enabled ? "bg-tone-success border-tone-success" : "bg-muted")}
          >
            <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-background shadow-xs transition-transform", enabled && "translate-x-4")} />
          </button>
        </label>
      )}
      <a href="#/policy/audit" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring sm:min-h-0">Open audit</a>
    </>
  );
}
