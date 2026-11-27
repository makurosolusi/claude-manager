import { Tooltip } from "@/components/ui/tooltip.tsx";
import { fmtUsd, plural } from "@/lib/format.ts";

/** Disclaimer attached to every cost figure. */
export const COST_NOTE = "Estimated at public API list prices. This is not your subscription bill.";

/** Estimated USD amount; an asterisk + tooltip flags unpriced requests. "est." lives in the column header. */
export function CostCell({ usd, unpriced = 0 }: { usd: number; unpriced?: number }) {
  const value = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      {fmtUsd(usd)}
    </span>
  );
  if (unpriced <= 0) return value;
  const note = `${plural(unpriced, "request")} with unknown pricing excluded`;
  return (
    <Tooltip focusable content={note}>
      {value}
      <span aria-hidden className="text-fg-subtle">
        *
      </span>
    </Tooltip>
  );
}
