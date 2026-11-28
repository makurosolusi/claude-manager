import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

/** Overview load failure with the server's message and a Retry button. */
export function OverviewError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 text-[13px]">
      <TriangleAlert aria-hidden className="size-4 text-destructive" />
      <span className="font-medium text-foreground">Couldn't load overview.</span>
      <span className="min-w-0 break-words text-muted-foreground">{message}</span>
      <Button size="xs" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}
