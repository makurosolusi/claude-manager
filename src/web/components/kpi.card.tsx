import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn.ts";
import { fmtDeltaPct } from "@/lib/format.ts";
import { TONE_CLASSES, type ToneKey } from "@/lib/color.tokens.ts";

/** Change vs the previous period; `value` null = no baseline. Shown in neutral grey (color is reserved for warnings). */
export interface KpiDelta {
  value: number | null;
  unit: "pct" | "pt";
  periodLabel: string;
  /** Previous-period value as text, shown instead of a % when the % would be noise ("$8.23"). */
  prevLabel?: string;
  /** Direction of the change when only `prevLabel` is shown. */
  trend?: "up" | "down";
  /** Previous period had nothing: "New this period". */
  isNew?: boolean;
}

/** Props of a headline KPI panel. */
export interface KpiCardProps {
  label: string;
  value: ReactNode;
  delta?: KpiDelta;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Colours the value with the tone text token (e.g. cache hit level). */
  tone?: ToneKey;
}

/** Deltas whose magnitude rounds below this read as "no change". */
const DELTA_EPSILON = 0.05;

function DeltaLine({ value, unit, periodLabel, prevLabel, trend, isNew }: KpiDelta) {
  if (isNew) return <p className="text-xs text-muted-foreground">New this period</p>;
  if (value === null && !prevLabel) return <p className="text-xs text-fg-subtle">No prior data</p>;
  const flat = value !== null && Math.abs(value) < DELTA_EPSILON;
  const dir = value === null ? trend : flat ? undefined : value > 0 ? "up" : "down";
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : ArrowRight;
  const word = dir ?? "unchanged";
  const amount = value === null ? `from ${prevLabel}` : unit === "pct" ? (flat ? "0.0%" : fmtDeltaPct(value)) : `${flat ? "0.0" : Math.abs(value).toFixed(1)} pt`;
  return (
    <p className="flex items-center gap-1 text-xs whitespace-nowrap">
      <span className="inline-flex items-center gap-0.5 font-medium text-muted-foreground tabular-nums">
        <Icon aria-hidden className="size-3" />
        <span className="sr-only">{word} </span>
        {amount}
      </span>
      <span className="text-fg-subtle">{value === null ? "prev" : "vs prev"} {periodLabel}</span>
    </p>
  );
}

/** Headline metric panel: label, large tabular value, optional neutral delta and hint line. */
export function KpiCard({ label, value, delta, hint, icon: Icon, tone }: KpiCardProps) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
        {label}
      </h2>
      <div className={cn("truncate text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums", tone ? TONE_CLASSES[tone].text : "text-card-foreground")}>{value}</div>
      {(delta || hint) && (
        <div className="flex flex-col gap-0.5">
          {delta && <DeltaLine {...delta} />}
          {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
        </div>
      )}
    </section>
  );
}
