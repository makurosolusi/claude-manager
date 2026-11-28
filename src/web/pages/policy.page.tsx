import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm.dialog.tsx";
import { NoticeBar } from "@/components/notice.bar.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { PolicyCause } from "@/components/policy.cause.tsx";
import { PolicyDiff } from "@/components/policy.diff.tsx";
import { PolicyFloors } from "@/components/policy.floors.tsx";
import { inputFromConfig, usePolicyFlow } from "@/components/policy.flow.tsx";
import { EscalationState, EscalationSwitch } from "@/components/policy.escalate.tsx";
import { PolicyActions } from "@/components/policy.header.tsx";
import { PolicyMatrix } from "@/components/policy.matrix.tsx";
import { DEFAULT_SETUP, formFromConfig, PolicySetup, PolicySummary, type SetupForm } from "@/components/policy.setup.tsx";
import { Panel } from "@/components/panel.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useApi } from "@/lib/api.client.ts";
import { useWriteMode } from "@/lib/agent.write.ts";
import { CLI_HINT } from "@/lib/policy.status.ts";
import type { PageProps } from "@/lib/page.props.ts";
import { PRESET_LABEL } from "../../policy/policy.presets.ts";
import type { PolicyResponse } from "../../server/policy.types.ts";

const SUBTITLE = "You decide what the manager's team may do without asking; the manager passes that on to its workers. Push and secrets always stay with you.";

/** Permission policy view of Agents: status, setup with preview and confirm, the matrix editor and the owner floors. */
export function PolicyPage({ dataVersion, params, roles }: PageProps) {
  const [retry, setRetry] = useState(0);
  const [form, setForm] = useState<SetupForm>(DEFAULT_SETUP);
  const [changing, setChanging] = useState(false);
  const write = useWriteMode();
  const { data, error, loading } = useApi<PolicyResponse>("/api/policy", {}, dataVersion + retry);
  const flow = usePolicyFlow(data, () => setRetry((n) => n + 1));
  const readOnly = write === false;
  const status = data?.status;
  const showSetup = write === true && !!data && status !== "blocked" && (status === "not_set_up" || params.get("setup") === "1" || changing);
  const stored = data?.config;
  const reapply = () => stored && flow.preview(inputFromConfig(stored), stored.preset);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Permission policy" description={SUBTITLE} actions={data && (
        <PolicyActions status={data.status} enabled={!!stored?.enabled} canSwitch={write === true && !!stored} readOnly={readOnly} busy={flow.busy}
          onToggle={() => (stored?.enabled ? flow.setAsk("disable") : reapply())} />
      )} />
      {flow.notice && <NoticeBar tone={flow.notice.tone} onClose={() => flow.setNotice(null)}>{flow.notice.text}</NoticeBar>}
      {flow.failure && (
        <NoticeBar tone="danger" onClose={() => flow.setFailure(null)}>
          {flow.failure.text}
          {flow.failure.reload && <Button size="xs" variant="outline" className="ml-2" onClick={() => { flow.setFailure(null); flow.setPending(null); setRetry((n) => n + 1); }}>Reload</Button>}
        </NoticeBar>
      )}
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
      {error && !data && (
        <Panel title="Couldn't load the policy"><p className="text-sm text-muted-foreground">{error.message}</p>
          <div><Button variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry</Button></div></Panel>
      )}
      {data && <PolicyCause policy={data} readOnly={readOnly} busy={flow.busy} onReapply={reapply} />}
      {readOnly && status !== "enforced" && <p className="font-mono text-xs text-muted-foreground">{CLI_HINT}</p>}
      {stored && !showSetup && !flow.pending && (
        <PolicySummary config={stored} onChange={write === true && status !== "blocked" ? () => { setForm(formFromConfig(stored)); setChanging(true); } : undefined}
          extra={write === true && status !== "blocked"
            ? <EscalationSwitch on={!!stored.escalate} busy={flow.busy} onToggle={() => (stored.escalate ? flow.setAsk("escalate_off") : flow.toggleEscalate(true))} />
            : <EscalationState on={!!stored.escalate} />} />
      )}
      {showSetup && !flow.pending && <PolicySetup form={form} onChange={setForm} busy={flow.busy} onPreview={() => flow.fromForm(form)} />}
      {flow.pending && <p className="text-xs text-muted-foreground">{flow.pending.input.escalate ? "Worker asks → manager (only the manager prompts you)." : "Worker asks → you (workers prompt you directly)."}</p>}
      {flow.pending && <PolicyDiff preview={flow.pending.data} title="Confirm & apply" busy={flow.busy} onApply={() => flow.setAsk("apply")} onCancel={() => flow.setPending(null)} />}
      {data && status !== "not_set_up" && <PolicyMatrix policy={data} roles={roles} editable={write === true && status !== "blocked"}
        onSaved={(text) => { flow.setNotice({ tone: "success", text }); setRetry((n) => n + 1); }} onFailure={(e) => flow.fail(e)} />}
      <PolicyFloors escalate={!!stored?.escalate} />
      <ConfirmDialog open={flow.ask === "apply"} busy={flow.busy} title="Apply policy?" confirmLabel="Apply"
        body={flow.pending && `Apply ${PRESET_LABEL[flow.pending.input.preset]} to ${flow.pending.data.settings_path}? Running sessions pick it up within seconds.`}
        onConfirm={flow.apply} onCancel={() => flow.setAsk(null)} />
      <ConfirmDialog open={flow.ask === "escalate_off"} busy={flow.busy} destructive title="Turn off escalation?" confirmLabel="Turn off"
        body="Workers will prompt you directly again." onConfirm={() => flow.toggleEscalate(false)} onCancel={() => flow.setAsk(null)} />
      <ConfirmDialog open={flow.ask === "disable"} busy={flow.busy} destructive title="Turn off the policy?" confirmLabel="Turn off"
        body="Workers will ask you for every tool again. Your matrix is kept." onConfirm={flow.disable} onCancel={() => flow.setAsk(null)} />
    </div>
  );
}
