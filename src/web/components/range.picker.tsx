import { cn } from "@/lib/cn.ts";
import { RANGES, type Range } from "@/lib/range.ts";

const LABEL: Record<Range, string> = { "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", all: "All" };

/** Segmented time-range control; always rendered, `disabled` on pages not filtered by time (no layout shift). */
export function RangePicker({ value, onChange, disabled }: { value: Range; onChange: (r: Range) => void; disabled?: boolean }) {
  return (
    <div
      role="group"
      aria-label="Time range"
      title={disabled ? "Not filtered by time range" : undefined}
      className={cn("inline-flex shrink-0 rounded-md border p-0.5", disabled && "opacity-50")}
    >
      {(Object.keys(RANGES) as Range[]).map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          aria-pressed={r === value}
          onClick={() => onChange(r)}
          className={cn(
            "h-6 rounded-sm px-2 text-xs font-medium tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring disabled:cursor-not-allowed",
            r === value ? "bg-surface-hover text-foreground" : "text-muted-foreground enabled:hover:text-foreground",
          )}
        >
          {LABEL[r]}
        </button>
      ))}
    </div>
  );
}
