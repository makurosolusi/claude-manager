import type { AgentKind, AgentRow, AgentScope } from "../../server/agents.types.ts";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { toolsLabel, toolsTitle } from "@/lib/agents.table.ts";
import { CUSTOM_ROLE_ICON, NAV_ICON, ROLE_ICON, UI_ICON } from "@/lib/icon.map.ts";

const KIND_LABEL: Record<AgentKind, string> = { preset: "Preset", custom: "Custom", external: "External" };
const KIND_ICON = { preset: NAV_ICON.roles, custom: CUSTOM_ROLE_ICON, external: ROLE_ICON.subagent! };
const NOT_MANAGED = "Not managed by claude-manager";
/** Scope states that need attention (a warning dot beside the chip). */
export const ATTENTION: AgentScope["state"][] = ["edited", "shadowed", "missing"];

/** Kind label with icon; external agents add only a lock whose tooltip says they are not managed. */
export function KindCell({ kind }: { kind: AgentKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]">
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />{KIND_LABEL[kind]}
      {kind === "external" && <span title={NOT_MANAGED} className="inline-flex"><UI_ICON.lock aria-hidden className="size-3 text-muted-foreground" /><span className="sr-only">{NOT_MANAGED}</span></span>}
    </span>
  );
}

/** Tools as text ("All tools", "Read-only · 3", "Read, Edit +1"); the title lists every tool. */
export function ToolsCell({ row }: { row: Pick<AgentRow, "name" | "source" | "tools" | "disallowed_tools"> }) {
  return <span title={toolsTitle(row)} className="block truncate text-[13px] text-muted-foreground">{toolsLabel(row)}</span>;
}

/** One scope chip; edited, shadowed or missing files get a warning dot and say why in the title. */
export function ScopeChip({ scope }: { scope: AgentScope }) {
  const warn = ATTENTION.includes(scope.state);
  return (
    <span title={`${scope.scope}: ${scope.state} (${scope.path})`} className="inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs whitespace-nowrap">
      {warn && <span aria-hidden className={cn("size-1.5 rounded-full", TONE_CLASSES.warning.dot)} />}
      {scope.scope}
      {warn && <span className="sr-only"> ({scope.state})</span>}
    </span>
  );
}

/** Scope chips of a row; a dash when not installed anywhere. */
export function ScopeCell({ scopes }: { scopes: AgentScope[] }) {
  if (!scopes.length) return <span className="text-fg-subtle">—</span>;
  return <span className="inline-flex gap-1">{scopes.map((s) => <ScopeChip key={s.scope} scope={s} />)}</span>;
}

/** "Disabled" chip for a switched-off preset. */
export const DisabledChip = () => <ToneBadge tone="neutral" icon={UI_ICON.empty}>Disabled</ToneBadge>;
