import { TONE_CLASSES, type ToneKey } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { DECISION_LABEL, decisionOptions } from "@/lib/policy.matrix.ts";
import type { Capability, Decision, PolicyRow } from "../../server/policy.types.ts";

const DECISION_TONE: Record<Decision, ToneKey> = { allow: "success", ask: "warning", deny: "danger", default: "neutral" };

interface Props {
  row: PolicyRow;
  cap: Capability;
  /** True when this cell has an unsaved edit. */
  staged: boolean;
  /** Read-only mode renders a badge instead of a select. */
  editable: boolean;
  onChange: (d: Decision) => void;
  /** What the preset gives this cell, for the "changed from preset" hint. */
  preset?: { label: string; decision: Decision };
}

/** One matrix cell: a tone dot plus a native select (never offers Allow on push), or a plain label in read-only mode. */
export function PolicyCell({ row, cap, staged, editable, onChange, preset }: Props) {
  const c = row.cells[cap];
  const edited = c.source === "override";
  const dot = <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_CLASSES[DECISION_TONE[c.decision]].dot)} />;
  const title = staged ? "Unsaved edit" : edited && preset ? `Changed from preset (${preset.label}: ${DECISION_LABEL[preset.decision]})` : edited ? "Changed from preset" : undefined;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 rounded-md", staged && "bg-tone-info-bg px-1 py-0.5 ring-2 ring-tone-info-border")}>
      {dot}
      {editable ? (
        <select
          aria-label={`${row.row} ${cap}`}
          value={c.decision}
          onChange={(e) => onChange(e.target.value as Decision)}
          className={cn("min-h-11 rounded-md border bg-background px-1.5 py-1 text-xs outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring sm:min-h-8", edited && "font-semibold")}
        >
          {decisionOptions(cap).map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
        </select>
      ) : <span className={cn("text-xs", edited && "font-semibold")}>{DECISION_LABEL[c.decision]}</span>}
      {staged ? <span className="text-[10px] font-medium text-foreground">unsaved</span> : edited && (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><span aria-hidden className="size-1.5 rounded-full bg-foreground" />edited</span>
      )}
    </span>
  );
}
