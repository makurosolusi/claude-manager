import { cn } from "@/lib/cn.ts";
import { RANGES, type Range } from "@/lib/range.ts";

/** Tooltip on the dimmed picker: pages that ignore the range say so. */
const DISABLED_HINT = "Live and session pages ignore the time range";

const LABEL: Record<Range, string> = { "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", all: "All" };

/** Segmented time-range control; always rendered, `disabled` on pages not filtered by time (no layout shift). */
export function RangePicker({ value, onChange, disabled }: { value: Range; onChange: (r: Range) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex" title={disabled ? DISABLED_HINT : undefined}>
      <select
        aria-label="Time range"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Range)}
        className="h-11 rounded-md border bg-background px-2 text-xs font-medium text-foreground outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 lg:hidden"
      >
        {(Object.keys(RANGES) as Range[]).map((r) => (
          <option key={r} value={r}>{LABEL[r]}</option>
        ))}
      </select>
    <div
      role="group"
      aria-label="Time range"
      className={cn("hidden shrink-0 rounded-md border p-0.5 lg:inline-flex", disabled && "opacity-50")}
    >
      {(Object.keys(RANGES) as Range[]).map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          aria-pressed={r === value}
          onClick={() => onChange(r)}
          className={cn(
            "min-h-11 rounded-sm px-3 sm:h-6 sm:min-h-0 sm:px-2 text-xs font-medium tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring disabled:cursor-not-allowed",
            r === value ? "bg-surface-hover text-foreground" : "text-muted-foreground enabled:hover:text-foreground",
          )}
        >
          {LABEL[r]}
        </button>
      ))}
    </div>
    </span>
  );
}
