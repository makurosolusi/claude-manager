import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  /** Make the wrapper itself the keyboard trigger (for non-interactive children like a number). */
  focusable?: boolean;
  className?: string;
}

/** CSS-only tooltip (no Radix): visible on hover or focus within the trigger. */
export function Tooltip({ content, children, side = "top", focusable, className }: TooltipProps) {
  const id = useId();
  return (
    <span
      className={cn("group/tip relative inline-flex rounded-sm", focusable && "cursor-help", className)}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={id}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute right-0 z-50 w-max max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-left text-xs font-normal whitespace-normal text-popover-foreground opacity-0 shadow-md",
          "transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}
