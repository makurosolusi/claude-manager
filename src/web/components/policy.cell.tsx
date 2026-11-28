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
}

/** One matrix cell: a tone dot plus a native select (never offers Allow on push), or a plain label in read-only mode. */
export function PolicyCell({ row, cap, staged, editable, onChange }: Props) {
  const c = row.cells[cap];
  const edited = c.source === "override";
  const dot = <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_CLASSES[DECISION_TONE[c.decision]].dot)} />;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md", staged && "bg-tone-info-bg ring-1 ring-tone-info-border")}>
      {dot}
      {editable ? (
        <select
          aria-label={`${row.row} ${cap}`}
          value={c.decision}
          onChange={(e) => onChange(e.target.value as Decision)}
          className="min-h-11 rounded-md border bg-background px-1.5 py-1 text-xs outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring sm:min-h-8"
        >
          {decisionOptions(cap).map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
        </select>
      ) : <span className="text-xs">{DECISION_LABEL[c.decision]}</span>}
      {(edited || staged) && <span className="text-[10px] text-muted-foreground">{staged ? "unsaved" : "edited"}</span>}
    </span>
  );
}
