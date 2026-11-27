import { fmtPct } from "@/lib/format.ts";
import { cn } from "@/lib/cn.ts";

/** Share clamped to 0..1; NaN counts as 0. */
export const clampShare = (share: number) => (Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0);

interface ShareBarProps {
  /** Fraction 0..1 of the whole. */
  share: number;
  /** Fill colour class; defaults to a neutral ink. */
  fill?: string;
  /** Renders the value muted (child rows). */
  dim?: boolean;
}

/** The one share-of-total mark: visible track + fill + 1-decimal percentage. */
export function ShareBar({ share, fill = "bg-foreground/60", dim }: ShareBarProps) {
  const r = clampShare(share);
  return (
    <span className={cn("inline-flex items-center justify-end gap-2", dim && "opacity-70")}>
      <span aria-hidden className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-foreground/15">
        <span className={cn("block h-full rounded-full", fill)} style={{ width: `${r * 100}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{fmtPct(r)}</span>
    </span>
  );
}
