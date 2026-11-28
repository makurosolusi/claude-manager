import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { PageProps } from "@/lib/page.props.ts";
import type { AgentDetail, AgentsResponse } from "../../server/agents.types.ts";
import { AgentActions } from "@/components/agent.actions.tsx";
import { AgentForm } from "@/components/agent.form.tsx";
import { AgentFormHeader } from "@/components/agent.form.header.tsx";
import { AgentNotice } from "@/components/agent.notice.tsx";
import { PermissionError, ReadOnlyBadge } from "@/components/agent.readonly.tsx";
import { DisabledChip, KindCell } from "@/components/agent.cells.tsx";
import { FilesPanel, ModelPanel, PermissionsPanel, PromptPanel, ToolsPanel, UsagePanel, WarningsPanel } from "@/components/agent.panels.tsx";
import { PolicyBannerHost } from "@/components/policy.banner.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getJson, isNotFound, useApi } from "@/lib/api.client.ts";
import { AGENT_LIVE_NOTE } from "@/lib/agent.copy.ts";
import { holdNotice, nextFrozen, useNotice, useWriteStatus, READ_ONLY_REASON, type WriteStatus } from "@/lib/agent.write.ts";
import { AGENTS_PATH } from "@/lib/agents.table.ts";
import { ROLE_ICON, UI_ICON } from "@/lib/icon.map.ts";

const BACK = `#${AGENTS_PATH}`;

const BackLink = () => <a href={BACK} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><UI_ICON.back aria-hidden className="size-4" />Agents</a>;

function Skeleton() {
  return (
    <div aria-busy role="status" aria-label="Loading agent" className="flex flex-col gap-4">
      <div className="h-7 w-1/3 animate-pulse rounded-sm bg-muted" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
        <div className="flex flex-col gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div>
      </div>
    </div>
  );
}

function Failure({ name, error, onRetry }: { name: string; error: Error; onRetry: () => void }) {
  if (isNotFound(error)) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Agent "{name}" not found. <a href={BACK} className="underline">Back to agents</a></p>;
  }
  return (
    <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 p-3 text-sm">
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 break-words">Couldn't load this agent. {error.message}</span>
      <Button size="xs" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

interface BodyProps extends Pick<PageProps, "tiers" | "roles"> {
  /** Refresh tick (`dataVersion + retry`) for the policy-backed panel. */
  tick: number;
  agent: AgentDetail;
  /** Edit permission: `write` shows actions, `read-only` the badge, `error` a Retry; `loading` shows nothing. */
  write: WriteStatus;
  onRetryWrite: () => void;
  /** Replaces the detail grid while editing. */
  form?: React.ReactNode;
  actions?: React.ReactNode;
  /** The success notice already carries the live-pickup note; do not repeat it in the footer. */
  hideLiveNote?: boolean;
}

function Body({ tick, agent, tiers, roles, write, onRetryWrite, form, actions, hideLiveNote }: BodyProps) {
  return (
    <>
      {!form && <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-xl font-semibold"><span className="sr-only">{agent.name}</span><span aria-hidden className="inline-flex [&>span]:h-7 [&>span]:px-2.5 [&>span]:text-base [&_svg]:size-4"><RoleBadge role={agent.name} roles={roles} /></span></h1>
          <KindCell kind={agent.kind} />
          {agent.main_agent && <ToneBadge tone="info" icon={ROLE_ICON.main!}>Main agent</ToneBadge>}
          {agent.status === "disabled" && <DisabledChip />}
          {agent.kind !== "external" && !form && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto max-sm:w-full">{write === "write" ? actions : write === "read-only" ? <ReadOnlyBadge /> : write === "error" && <PermissionError onRetry={onRetryWrite} />}</div>
          )}
        </div>
        {agent.description && <p className="max-w-prose text-sm text-muted-foreground">{agent.description}</p>}
      </div>}
      {agent.kind === "external" && <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><UI_ICON.lock aria-hidden className="size-3.5" />Not managed by claude-manager. Edit the file directly.</p>}
      {form ?? <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 max-lg:order-2"><PromptPanel agent={agent} /></div>
        <div className="flex min-w-0 flex-col gap-4 max-lg:contents [&>*]:min-w-0">
          <div className="max-lg:order-1 flex flex-col gap-4"><WarningsPanel warnings={agent.warnings} /><ModelPanel agent={agent} tiers={tiers} /><ToolsPanel agent={agent} /><PermissionsPanel agent={agent} tick={tick} /></div>
          <div className="max-lg:order-3 flex flex-col gap-4"><FilesPanel agent={agent} /><UsagePanel agent={agent} /></div>
        </div>
      </div>}
      {!hideLiveNote && <p className="text-xs text-fg-subtle">{AGENT_LIVE_NOTE}</p>}
    </>
  );
}

/** One agent: title row, system prompt, model, tools, files, 30-day usage and warnings; Edit, Disable/Enable and Delete unless read-only. */
export function AgentDetailPage({ name, dataVersion, params, tiers, roles }: PageProps & { name: string }) {
  const [retry, setRetry] = useState(0);
  const reload = () => setRetry((n) => n + 1);
  const { status: write, retry: retryWrite } = useWriteStatus();
  const path = `${AGENTS_PATH}/${encodeURIComponent(name)}`;
  const editParam = params.get("edit") === "1";
  const [notice, setNotice] = useNotice(path, `${path}?${params}`);
  const apiPath = `/api/agents/${encodeURIComponent(name)}`;
  const { data, error } = useApi<AgentDetail>(apiPath, {}, dataVersion + retry);
  const editing = editParam && write === "write" && !!data && data.kind !== "external";
  const list = useApi<AgentsResponse>(editing ? "/api/agents" : null, {}, dataVersion + retry);
  // The form works from a snapshot taken when editing starts: sync ticks keep refreshing `data`, but the etag and the
  // starting values must not follow, or a change made elsewhere would never answer 412.
  const [frozen, setFrozen] = useState<AgentDetail | null>(null);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => { setFrozen((f) => nextFrozen(f, editing, data)); }, [editing, data, frozen]);
  // Reload (412 banner): fetch the newest detail now and restart the form from it.
  const restart = () => {
    reload();
    getJson<AgentDetail>(apiPath).then(setFrozen, (e: unknown) => { console.warn("agent reload failed", e); setFrozen(null); }).finally(() => setFormKey((n) => n + 1));
  };
  useEffect(() => {
    if (!editParam || write !== "read-only") return;
    holdNotice({ tone: "info", text: `Editing is unavailable. ${READ_ONLY_REASON}` }, path);
    location.replace(`#${path}`);
  }, [editParam, write, path]);
  const form = editing && frozen ? (list.data
    ? <AgentForm key={formKey} agent={frozen} tiers={list.data.tiers} knownTools={list.data.known_tools} etag={frozen.etag} onReload={restart} />
    : <Skeleton />) : undefined;
  return (
    <div className="flex flex-col gap-4">
      {form ? <AgentFormHeader backHref={`#${path}`} backLabel={name} title={`Edit ${name}`} /> : <BackLink />}
      {!form && <PolicyBannerHost tick={dataVersion + retry} />}
      <AgentNotice notice={notice} onClose={() => setNotice(null)} />
      {!data && error ? <Failure name={name} error={error} onRetry={reload} />
        : !data ? <Skeleton /> : <Body tick={dataVersion + retry} agent={data} tiers={tiers} roles={roles} write={write} onRetryWrite={retryWrite} form={form} hideLiveNote={!!notice?.live} actions={<AgentActions agent={data} onNotice={setNotice} onReload={reload} />} />}
    </div>
  );
}
