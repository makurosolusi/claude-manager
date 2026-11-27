import { Tooltip } from "@/components/ui/tooltip.tsx";
import { HEAT_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { fmtInt, fmtUsd } from "@/lib/format.ts";
import { costHeat, type HeatScale } from "@/lib/status.level.ts";

/** Disclaimer attached to every cost figure. */
export const COST_NOTE = "Estimated at public API list prices. This is not your subscription bill.";

/** Estimated USD amount; optional `heat` adds a 3x12px absolute-scale bar; an asterisk + tooltip flags unpriced requests. "est." lives in the column header. */
export function CostCell({ usd, unpriced = 0, heat }: { usd: number; unpriced?: number; heat?: HeatScale }) {
  const step = heat ? costHeat(usd, heat) : null;
  const value = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      {step && <span aria-hidden data-heat={step} className={cn("h-3 w-[3px] shrink-0 rounded-full", HEAT_CLASSES[step - 1])} />}
      {fmtUsd(usd)}
    </span>
  );
  if (unpriced <= 0) return value;
  const note = `${fmtInt(unpriced)} ${unpriced === 1 ? "request" : "requests"} with unknown pricing excluded`;
  return (
    <Tooltip focusable content={note}>
      {value}
      <span aria-hidden className="text-fg-subtle">
        *
      </span>
    </Tooltip>
  );
}
