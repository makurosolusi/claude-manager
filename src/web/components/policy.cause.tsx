import { Button } from "@/components/ui/button.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { CLI_HINT, driftCause, type DriftCause } from "@/lib/policy.status.ts";
import type { PolicyResponse } from "../../server/policy.types.ts";

const FIX: Record<DriftCause, string> = {
  hook_missing: "The hook entry is missing from the settings file. Re-apply restores it.",
  hook_edited: "The hook entry was edited by hand. Re-apply restores it.",
  snapshot_stale: "The compiled snapshot is out of date. Re-apply rewrites it.",
  other: "Re-apply writes the settings entries and the snapshot again.",
};

/** Explains a drift or blocked policy and offers the fix (Re-apply, or the CLI hint in read-only mode). */
export function PolicyCause({ policy, readOnly, busy, onReapply }: { policy: PolicyResponse; readOnly: boolean; busy: boolean; onReapply: () => void }) {
  if (policy.status !== "drift" && policy.status !== "blocked") return null;
  const drift = policy.status === "drift";
  return (
    <div role="alert" className={`rounded-md border px-3 py-2 text-sm ${TONE_CLASSES[drift ? "danger" : "info"].badge}`}>
      <p className="font-medium">{drift ? "Policy is set but not enforced" : "Blocked by your organization's managed settings"}</p>
      <ul className="mt-1 list-disc pl-4 text-xs">{policy.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {drift && <p className="mt-1 text-xs">{FIX[driftCause(policy.reasons)]}</p>}
      {drift && (readOnly ? <p className="mt-1 font-mono text-xs">{CLI_HINT}</p> : <Button className="mt-2 min-h-11 sm:min-h-0" size="sm" variant="outline" disabled={busy} onClick={onReapply}>Re-apply</Button>)}
    </div>
  );
}
