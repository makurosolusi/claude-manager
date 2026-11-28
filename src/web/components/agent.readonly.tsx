import { Lock } from "lucide-react";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { READ_ONLY_REASON } from "@/lib/agent.write.ts";

/** "Read-only" badge with the reason as tooltip and visible text. */
export function ReadOnlyBadge() {
  return (
    <span className="inline-flex flex-wrap items-center gap-2" title={READ_ONLY_REASON}>
      <ToneBadge tone="warning" icon={Lock}>Read-only</ToneBadge>
      <span className="text-xs text-muted-foreground">{READ_ONLY_REASON}</span>
    </span>
  );
}
