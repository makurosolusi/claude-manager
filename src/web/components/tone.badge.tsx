import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TONE_CLASSES, type HueClasses, type ToneKey } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";

interface ToneBadgeProps {
  /** Semantic tone, used unless `hue` is given. */
  tone?: ToneKey;
  /** Explicit hue classes (family / role); overrides `tone`. */
  hue?: HueClasses;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** 20px badge: icon + label with fg/border tokens (bg only if the hue has one); colour is never the only cue. */
export function ToneBadge({ tone = "neutral", hue, icon: Icon, children, className }: ToneBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap",
        (hue ?? TONE_CLASSES[tone]).badge,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate" title={typeof children === "string" ? children : undefined}>{children}</span>
    </span>
  );
}
