import { cn } from "@/lib/cn.ts";
import { contextLevel } from "@/lib/context.level.ts";
import { fmtTokens } from "@/lib/format.ts";

const FILL = { ok: "bg-ok", warn: "bg-warn", danger: "bg-destructive" } as const;

/** Meter of context window USED (not left), colored by level and always labeled "142k / 200k · 71%". */
export function ContextBar({ used, window, size = "sm" }: { used: number; window: number; size?: "sm" | "md" }) {
  const pct = window > 0 ? Math.round((used / window) * 100) : 0;
  const level = contextLevel(pct);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="meter"
        aria-label="Context used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        aria-valuetext={`${pct}% used`}
        className={cn("flex-1 overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : "h-2")}
      >
        <div className={cn("h-full rounded-full", FILL[level])} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {fmtTokens(used)} / {fmtTokens(window)} · <span className={cn(level !== "ok" && "font-medium text-foreground")}>{pct}%</span>
      </span>
    </div>
  );
}
