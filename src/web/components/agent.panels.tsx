import { Ban, Check, CircleHelp, Minus, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentDetail } from "../../server/agents.types.ts";
import { CopyButton } from "@/components/agent.copy.tsx";
import { ScopeChip } from "@/components/agent.cells.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { ModelChain } from "@/components/model.chain.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { Panel } from "@/components/panel.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { TONE_CLASSES, type ToneKey } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { fmtInt } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { toolIcon } from "@/lib/icon.map.ts";
import type { Tiers } from "@/lib/model.tier.ts";
import { CAPABILITIES } from "../../policy/policy.presets.ts";
import { usePolicy, rowForAgent } from "@/lib/policy.use.ts";
import { goesToManager, isEscalated } from "@/lib/policy.status.ts";
import { CAP_NOUN, DECISION_LABEL } from "@/lib/policy.matrix.ts";
import type { Decision } from "../../server/policy.types.ts";

/** Where the system prompt came from, in words. */
const PROMPT_SOURCE = { default: "default prompt", config: "from config", file: "from file" } as const;
const ALL_TOOLS = "All tools except Agent";

/** Per-agent warnings in the warning tone; nothing when there are none. */
export function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <Panel title="Warnings" count={warnings.length} className={TONE_CLASSES.warning.badge}>
      <ul className="flex flex-col gap-2 text-[13px]">
        {warnings.map((w) => <li key={w} className="flex items-start gap-2"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{w}</li>)}
      </ul>
    </Panel>
  );
}

/** System prompt (plain text) with its source and a Copy button. */
export function PromptPanel({ agent }: { agent: AgentDetail }) {
  return (
    <Panel
      title="System prompt"
      action={<span className="flex items-center gap-2 text-xs text-fg-subtle">{agent.prompt_source && PROMPT_SOURCE[agent.prompt_source]}{agent.prompt && <CopyButton text={agent.prompt} label="Copy system prompt" withLabel />}</span>}
    >
      {agent.prompt ? <pre className="max-h-[70vh] overflow-auto font-mono text-[12.5px] whitespace-pre-wrap break-words">{agent.prompt}</pre> : <p className="text-sm text-muted-foreground">No prompt available.</p>}
    </Panel>
  );
}

/** What decides this agent's model, in words. */
function modelNote(a: Pick<AgentDetail, "tier" | "pin" | "name">): ReactNode {
  if (a.pin) return `Pinned to ${a.pin}`;
  if (a.tier) return <>Tier-routed: changes when you run <code className="font-mono">claude-manager tier set {a.tier} &lt;model-id&gt;</code></>;
  return "Inherits the main session's model";
}

/** Model chain plus the tier → model ID it resolves to. */
export function ModelPanel({ agent, tiers }: { agent: AgentDetail; tiers?: Tiers }) {
  return (
    <Panel title="Model">
      <ModelChain row={agent} tiers={tiers} className="flex-wrap whitespace-normal" />
      <p className="text-xs text-muted-foreground">{modelNote(agent)}</p>
    </Panel>
  );
}

/** Tool chips with icons, or the inherit-all note. */
export function ToolsPanel({ agent }: { agent: AgentDetail }) {
  const note: ReactNode = agent.disallowed_tools?.length ? `All tools except ${agent.disallowed_tools.join(", ")}` : ALL_TOOLS;
  return (
    <Panel title="Tools" count={agent.tools?.length}>
      {!agent.tools ? <p className="text-sm text-muted-foreground">{note}</p> : (
        <ul className="flex flex-wrap gap-1.5">
          {agent.tools.map((t) => { const I = toolIcon(t); return <li key={t} className="inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 font-mono text-xs"><I aria-hidden className="size-3.5 text-muted-foreground" />{t}</li>; })}
        </ul>
      )}
    </Panel>
  );
}

/** One row per scope file: chip, state, path (mono) and copy. External agents show their single file. */
export function FilesPanel({ agent }: { agent: AgentDetail }) {
  const files = agent.scopes.length ? agent.scopes.map((s) => ({ key: s.scope, path: s.path, chip: <ScopeChip scope={s} />, state: s.state })) : agent.file_path ? [{ key: "file", path: agent.file_path, chip: null, state: null }] : [];
  return (
    <Panel title="Files">
      {!files.length ? <p className="text-sm text-muted-foreground">Not written to any file yet.</p> : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.key} className="flex items-start gap-2">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">{f.chip}{f.state}</span>
                <code className="font-mono text-[11px] leading-snug break-all">{f.path}</code>
              </span>
              <CopyButton text={f.path} label={`Copy ${f.key} path`} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** 30-day usage with a link to the Roles page filtered to this agent. */
export function UsagePanel({ agent }: { agent: AgentDetail }) {
  const u = agent.usage;
  const rows: [string, ReactNode][] = [
    ["Requests", fmtInt(u.requests)], ["Cost (est.)", <CostCell usd={u.cost_usd} unpriced={u.unpriced} />], ["Last used", <RelativeTime iso={u.last_ts} />],
    ...(u.rerouted_pct === null ? [] : [["Rerouted", <span className={cn("tabular-nums", u.rerouted_pct > 0 && TONE_CLASSES.warning.text)}>{u.rerouted_pct.toFixed(1)}%</span>] as [string, ReactNode]]),
  ];
  return (
    <Panel title="Usage, last 30 days" action={<a href={hashHref("/roles", { q: agent.name })} className="text-xs underline-offset-2 hover:underline">View in Roles</a>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}
      </dl>
    </Panel>
  );
}

const DECISION_VIEW: Record<Decision, { tone: ToneKey; icon: typeof Check }> = {
  allow: { tone: "success", icon: Check }, ask: { tone: "warning", icon: CircleHelp }, deny: { tone: "danger", icon: Ban }, default: { tone: "neutral", icon: Minus },
};

/** Permission cells that apply to this agent (its own policy row, or the unknown row for externals), one chip per capability; overrides are marked "edited". */
export function PermissionsPanel({ agent, tick }: { agent: Pick<AgentDetail, "name" | "kind">; tick: number }) {
  const { data } = usePolicy(tick);
  const row = rowForAgent(data?.rows, agent);
  if (!data || !row) return null;
  const off = data.status !== "enforced";
  const viaManager = isEscalated(row, data.config?.escalate);
  return (
    <Panel title="Permissions" action={<a href="#/policy" className="text-xs underline-offset-2 hover:underline">Edit in policy</a>}>
      {off && <p className="text-xs text-muted-foreground">Policy is not enforced, so workers ask for every tool. Cells below apply once it is.</p>}
      {agent.kind === "external" && <p className="text-sm text-muted-foreground">Uses the unknown row</p>}
      <ul className="flex flex-wrap gap-1.5">
        {CAPABILITIES.map((c) => {
          const cell = row.cells[c], v = DECISION_VIEW[cell.decision];
          return <li key={c}><ToneBadge tone={v.tone} icon={v.icon} className={cn(off && "opacity-60")}>{`${CAP_NOUN[c]}: ${viaManager && goesToManager(row, c, cell.decision, true) ? `${DECISION_LABEL[cell.decision]} → manager` : DECISION_LABEL[cell.decision]}${cell.source === "override" ? " · edited" : ""}`}</ToneBadge></li>;
        })}
      </ul>
    </Panel>
  );
}
