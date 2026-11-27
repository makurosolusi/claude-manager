import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { contextLevel } from "@/lib/context.level.ts";
import { fmtTokens } from "@/lib/format.ts";
import { LEVEL_ICON } from "@/lib/icon.map.ts";
import { LEVEL_TONE } from "@/lib/status.level.ts";

/** Meter of context window USED (not left): tone fill and icon (success/warning/danger), % in plain ink, labeled "142k / 200k · 71%". */
export function ContextBar({ used, window, size = "sm" }: { used: number; window: number; size?: "sm" | "md" }) {
  const pct = window > 0 ? Math.round((used / window) * 100) : 0;
  const level = contextLevel(pct);
  const tone = TONE_CLASSES[LEVEL_TONE[level]];
  const Icon = LEVEL_ICON[level];
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
        <div className={cn("h-full rounded-full", tone.dot)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        <Icon aria-hidden className={cn("size-3.5", tone.text)} />
        {fmtTokens(used)} / {fmtTokens(window)} · <span className="font-medium text-foreground">{pct}%</span>
      </span>
    </div>
  );
}
