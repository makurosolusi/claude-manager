import { TriangleAlert } from "lucide-react";
import type { AgentRow } from "../../server/agents.types.ts";
import { ATTENTION, DisabledChip } from "@/components/agent.cells.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { TONE_CLASSES, type RoleMeta } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { UI_ICON } from "@/lib/icon.map.ts";

const SOURCE_LABEL = { builtin: "built-in", file: "file", plugin: "plugin", unknown: "seen in usage" } as const;

const manualNote = (source: AgentRow["source"]) => `Not managed by claude-manager (${SOURCE_LABEL[source ?? "unknown"]})`;
const attentionNote = (scopes: AgentRow["scopes"]) =>
  scopes.filter((s) => ATTENTION.includes(s.state)).map((s) => `${s.scope}: ${s.state} (${s.path})`).join("\n");

interface Props {
  row: AgentRow;
  roles?: readonly RoleMeta[];
  /** Show the "Main" chip (hidden when the table is grouped by level, where a Main group says it). */
  showMain: boolean;
}

/** Agent column: role badge plus Main, Disabled, not-managed lock and needs-attention markers. Replaces the old Kind and Scope columns. */
export function AgentNameCell({ row, roles, showMain }: Props) {
  const warn = attentionNote(row.scopes);
  return (
    <span className={cn("flex min-w-0 items-center gap-2", row.status === "disabled" && "opacity-60")}>
      <RoleBadge role={row.name} roles={roles} />
      {showMain && row.main_agent && row.kind !== "external" && <ToneBadge icon={UI_ICON.crown}>Main</ToneBadge>}
      {row.status === "disabled" && <DisabledChip />}
      {row.kind === "external" && (
        <span title={manualNote(row.source)} className="inline-flex shrink-0">
          <UI_ICON.lock aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="sr-only">{manualNote(row.source)}</span>
        </span>
      )}
      {warn && (
        <span title={warn} className="inline-flex shrink-0">
          <TriangleAlert aria-hidden className={cn("size-3.5", TONE_CLASSES.warning.text)} />
          <span className="sr-only">{warn}</span>
        </span>
      )}
    </span>
  );
}
