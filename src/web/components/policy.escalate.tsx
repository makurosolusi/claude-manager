import { cn } from "@/lib/cn.ts";

interface Props { on: boolean; busy: boolean; onToggle: () => void }

/** Native-style switch for worker escalation (Enforce-switch pattern); only rendered when the viewer may write. */
export function EscalationSwitch({ on, busy, onToggle }: Props) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0" title="Worker asks go to the manager instead of prompting you">
      Escalation
      <button
        type="button" role="switch" aria-checked={on} disabled={busy} onClick={onToggle}
        className={cn("relative h-5 w-9 rounded-full border outline-hidden transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring disabled:opacity-50", on ? "bg-tone-success border-tone-success" : "bg-muted")}
      >
        <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-background shadow-xs transition-transform", on && "translate-x-4")} />
      </button>
    </label>
  );
}

/** Read-only state text for the summary row. */
export const EscalationState = ({ on }: { on: boolean }) => (
  <span className="text-sm text-muted-foreground">Escalation: {on ? "on" : "off"}</span>
);
