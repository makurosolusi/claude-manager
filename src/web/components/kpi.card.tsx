import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

/** Change vs the previous period; `value` null = no baseline. Shown in neutral grey (color is reserved for warnings). */
export interface KpiDelta {
  value: number | null;
  unit: "pct" | "pt";
  periodLabel: string;
}

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  delta?: KpiDelta;
  hint?: ReactNode;
}

/** Deltas whose magnitude rounds below this read as "no change". */
const DELTA_EPSILON = 0.05;

function DeltaLine({ value, unit, periodLabel }: KpiDelta) {
  if (value === null) return <p className="text-xs text-fg-subtle">No prior data</p>;
  const flat = Math.abs(value) < DELTA_EPSILON;
  const Icon = flat ? ArrowRight : value > 0 ? ArrowUp : ArrowDown;
  const word = flat ? "unchanged" : value > 0 ? "up" : "down";
  const amount = `${flat ? "0.0" : Math.abs(value).toFixed(1)}${unit === "pct" ? "%" : " pt"}`;
  return (
    <p className="flex items-center gap-1 text-xs whitespace-nowrap">
      <span className="inline-flex items-center gap-0.5 font-medium text-muted-foreground tabular-nums">
        <Icon aria-hidden className="size-3" />
        <span className="sr-only">{word} </span>
        {amount}
      </span>
      <span className="text-fg-subtle">vs prev {periodLabel}</span>
    </p>
  );
}

/** Headline metric panel: label, large tabular value, optional neutral delta and hint line. */
export function KpiCard({ label, value, delta, hint }: KpiCardProps) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
      <h2 className="text-[13px] font-medium text-muted-foreground">{label}</h2>
      <div className="truncate text-[28px] leading-none font-semibold tracking-[-0.02em] text-card-foreground tabular-nums">{value}</div>
      {(delta || hint) && (
        <div className="flex flex-col gap-0.5">
          {delta && <DeltaLine {...delta} />}
          {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
        </div>
      )}
    </section>
  );
}
