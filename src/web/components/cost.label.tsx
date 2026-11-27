import { fmtUsd } from "@/lib/format.ts";

/** Disclaimer attached to every cost figure. */
export const COST_NOTE = "Estimated at public API list prices. This is not your subscription bill.";

/** USD amount tagged "est." with the estimate disclaimer as a tooltip. */
export function Cost({ usd }: { usd: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums" title={COST_NOTE}>
      {fmtUsd(usd)} <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">est.</span>
    </span>
  );
}
