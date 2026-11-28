import { useState } from "react";
import type { SetupForm } from "@/components/policy.setup.tsx";
import { ApiWriteError } from "@/lib/api.write.ts";
import type { Notice } from "@/lib/agent.write.ts";
import { disablePolicy, enablePolicy, previewPolicy, setEscalate } from "@/lib/policy.write.ts";
import type { PolicyConfig, PolicyInput, PolicyPreview, PolicyResponse } from "../../server/policy.types.ts";

export interface Failure { text: string; reload: boolean }
export interface Pending { input: PolicyInput; data: PolicyPreview; label: string }
export type Ask = "apply" | "disable" | "escalate_off" | null;

/** Maps a failed write to banner text; 412 asks for a reload, everything else shows the server message (409 carries the fix command). */
export function toFailure(err: unknown): Failure {
  if (!(err instanceof ApiWriteError)) return { text: err instanceof Error ? err.message : String(err), reload: false };
  if (err.status === 412) return { text: `The policy changed since you opened this page (${err.serverMessage}).`, reload: true };
  return { text: err.serverMessage, reload: false };
}

/** PolicyInput that re-applies the stored config (Turn on, Repair). */
export const inputFromConfig = (c: PolicyConfig): PolicyInput =>
  ({ preset: c.preset, scope: c.scope, overrides: c.overrides, defaultMode: c.defaultMode ?? null, testCommands: c.testCommands, escalate: !!c.escalate });

/** Preview → confirm → apply and confirm → disable, with busy, notice and failure state for the Policy page. */
export function usePolicyFlow(policy: PolicyResponse | undefined, refetch: () => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try { await fn(); } catch (e) { setFailure(toFailure(e)); setAsk(null); } finally { setBusy(false); }
  };
  const preview = (input: PolicyInput, label: string) => run(async () => {
    if (!policy) return;
    setNotice(null);
    setPending({ input, label, data: await previewPolicy(input, policy.etag) });
  });
  const fromForm = (f: SetupForm) => preview({ preset: f.preset, scope: f.scope, defaultMode: f.acceptEdits ? "acceptEdits" : null, overrides: policy?.config?.overrides, testCommands: policy?.config?.testCommands, escalate: f.escalate }, f.preset);
  const apply = () => run(async () => {
    if (!pending) return;
    await enablePolicy(pending.input, pending.data.etag);
    // The setup card is open via ?setup=1; leave that URL so it closes now that the policy is applied.
    if (location.hash.includes("setup=1")) location.replace("#/policy");
    setPending(null); setAsk(null); setNotice({ tone: "success", text: "Policy applied. Running sessions pick it up within seconds." });
    refetch();
  });
  const disable = () => run(async () => {
    if (!policy) return;
    await disablePolicy(policy.etag);
    setAsk(null); setNotice({ tone: "success", text: "Policy turned off. Workers ask you for every tool again." });
    refetch();
  });
  const toggleEscalate = (on: boolean) => run(async () => {
    if (!policy) return;
    await setEscalate(on, policy.etag);
    setAsk(null); setNotice({ tone: "success", text: on ? "Escalation on. Worker asks now go to the manager." : "Escalation off. Workers prompt you directly again." });
    refetch();
  });
  const fail = (e: unknown) => setFailure(toFailure(e));
  return { fail, pending, setPending, ask, setAsk, busy, notice, setNotice, failure, setFailure, preview, fromForm, apply, disable, toggleEscalate };
}
