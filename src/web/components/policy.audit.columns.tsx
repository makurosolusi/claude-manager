import { CircleAlert, CircleCheck, CircleHelp, CircleX, type LucideIcon } from "lucide-react";
import type { AuditRow } from "../../server/policy.types.ts";
import type { Column } from "@/components/data.table.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import type { RoleMeta, ToneKey } from "@/lib/color.tokens.ts";

export const DECISION_TONE: Record<string, ToneKey> = { allow: "success", ask: "warning", deny: "danger", error: "neutral" };
const DECISION_ICON: Record<string, LucideIcon> = { allow: CircleCheck, ask: CircleHelp, deny: CircleX, error: CircleAlert };
const Dash = () => <span className="text-fg-subtle">—</span>;

/** Audit table columns; at 390 only Time, Role and Decision remain. */
export function auditColumns(roles?: readonly RoleMeta[]): Column<AuditRow>[] {
  return [
    { id: "time", header: "Time", primary: true, cell: (r) => <RelativeTime iso={r.ts} />, width: "w-28", hideable: false },
    { id: "role", header: "Agent", cell: (r) => <RoleBadge role={r.role} roles={roles} />, width: "w-36" },
    { id: "tool", header: "Tool", cell: (r) => <span className="font-mono text-xs">{r.tool}</span>, width: "w-40", hideBelow: "md" },
    { id: "cap", header: "Capability", cell: (r) => (r.cap ? <span className="font-mono text-xs">{r.cap}</span> : <Dash />), width: "w-32", hideBelow: "md" },
    { id: "decision", header: "Decision", cell: (r) => <ToneBadge tone={DECISION_TONE[r.decision] ?? "neutral"} icon={DECISION_ICON[r.decision] ?? CircleAlert}>{r.decision}</ToneBadge>, width: "w-24" },
    { id: "rule", header: "Rule", fill: true, cell: (r) => <span className="block truncate font-mono text-xs text-muted-foreground" title={r.rule}>{r.rule}</span>, hideBelow: "lg" },
  ];
}
