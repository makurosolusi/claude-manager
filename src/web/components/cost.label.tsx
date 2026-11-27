import { COST_NOTE } from "@/components/cost.cell.tsx";
import { fmtUsd } from "@/lib/format.ts";

// COST_NOTE moved to cost.cell.tsx (PLAN/05 §3.1); re-exported so old importers keep compiling until wave 2 (then delete this file, §7).
export { COST_NOTE };

/** USD amount tagged "est." with the estimate disclaimer as a tooltip. */
export function Cost({ usd }: { usd: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums" title={COST_NOTE}>
      {fmtUsd(usd)} <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">est.</span>
    </span>
  );
}
