import type { ReactNode } from "react";
import { FAMILY_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { fmtModel } from "@/lib/format.ts";
import { modelFamily } from "@/lib/model.tier.ts";

/** 8px dot in the model's family colour (mark only; always next to a text label). */
export function ModelDot({ model, className }: { model: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", FAMILY_CLASSES[modelFamily(model)].dot, className)} />;
}

/** Family dot + mono model id; `extra` (e.g. "+2") trails in muted text. */
export function ModelBadge({ model, extra }: { model: string; extra?: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap" title={model}>
      <ModelDot model={model} />
      <span className="truncate font-mono text-xs">{fmtModel(model)}</span>
      {extra != null && <span className="text-xs text-muted-foreground">{extra}</span>}
    </span>
  );
}
