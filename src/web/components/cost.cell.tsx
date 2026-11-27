import { Tooltip } from "@/components/ui/tooltip.tsx";
import { fmtInt, fmtUsd } from "@/lib/format.ts";

/** Estimated USD amount; an asterisk + tooltip flags requests excluded for unknown pricing. "est." lives in the column header. */
export function CostCell({ usd, unpriced = 0 }: { usd: number; unpriced?: number }) {
  const value = <span className="whitespace-nowrap tabular-nums">{fmtUsd(usd)}</span>;
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
