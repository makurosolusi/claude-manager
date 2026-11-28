import { Lock, TriangleAlert } from "lucide-react";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { Button } from "@/components/ui/button.tsx";
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

/** Shown when `/api/session` could not be read: writes stay hidden, with a Retry. */
export function PermissionError({ onRetry }: { onRetry: () => void }) {
  return (
    <span role="alert" className="inline-flex flex-wrap items-center gap-2">
      <ToneBadge tone="danger" icon={TriangleAlert}>Couldn't check edit permissions</ToneBadge>
      <Button size="xs" variant="outline" onClick={onRetry}>Retry</Button>
    </span>
  );
}
