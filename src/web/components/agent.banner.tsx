import { TriangleAlert } from "lucide-react";
import type { AgentsResponse } from "../../server/agents.types.ts";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";

const NOT_INSTALLED = "claude-manager isn't installed in any scope. Changes are saved to config and written on `claude-manager install`.";

/** Banner above the Agents table: global warnings and the not-installed note. Nothing when there is nothing to say. */
export function AgentBanner({ data }: { data: Pick<AgentsResponse, "warnings" | "installed"> }) {
  return (
    <div className="flex flex-col gap-2">
      {data.warnings.map((w) => (
        <p key={w} role="status" className={cn("flex items-start gap-2 rounded-md border p-3 text-[13px]", TONE_CLASSES.warning.badge)}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{w}
        </p>
      ))}
      {!data.installed && <p className="rounded-md border p-3 text-[13px] text-muted-foreground">{NOT_INSTALLED}</p>}
    </div>
  );
}
