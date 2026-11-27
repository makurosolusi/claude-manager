import type { Usage } from "../../server/dashboard.types.ts";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { cacheHitRate, fmtInt, fmtPct, fmtTokens } from "@/lib/format.ts";

type TokenUsage = Pick<Usage, "input" | "output" | "cache_read" | "cache_write">;

/** Compact total tokens (input + output + cache) with a focusable per-kind breakdown tooltip. */
export function TokenCell({ usage }: { usage: TokenUsage }) {
  const total = usage.input + usage.output + usage.cache_read + usage.cache_write;
  const rows: [string, number][] = [
    ["Input", usage.input],
    ["Output", usage.output],
    ["Cache read", usage.cache_read],
    ["Cache write", usage.cache_write],
  ];
  return (
    <Tooltip
      focusable
      content={
        <span className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums">
          {rows.map(([k, v]) => (
            <span key={k} className="contents">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right">{fmtInt(v)}</span>
            </span>
          ))}
          <span className="col-span-2 my-1 border-t" />
          <span className="text-muted-foreground">Cache hit</span>
          <span className="text-right">{fmtPct(cacheHitRate(usage))}</span>
        </span>
      }
    >
      <span className="tabular-nums">{fmtTokens(total)}</span>
    </Tooltip>
  );
}
