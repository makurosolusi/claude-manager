// shadcn/ui new-york-v4 Progress (MIT), with the Radix primitive replaced by a plain ARIA progressbar.
import * as React from "react"
import { cn } from "@/lib/cn.ts"

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: React.ComponentProps<"div"> & { value: number; indicatorClassName?: string }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn("h-full w-full flex-1 bg-primary transition-all", indicatorClassName)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </div>
  )
}

export { Progress }
