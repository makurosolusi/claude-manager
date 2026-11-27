import type { ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import type { ApiState } from "@/lib/api.client.ts";

/** Renders loading / error / empty states for an API call, else `children(data)`. */
export function StatusView<T>({
  state,
  isEmpty,
  emptyText = "No data for this range.",
  children,
}: {
  state: ApiState<T>;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  children: (data: T) => ReactNode;
}) {
  const { data, error, loading } = state;
  return (
    <>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{error.message}</span>
        </div>
      )}
      {data === undefined ? (
        loading && (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        )
      ) : isEmpty?.(data) ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children(data)
      )}
    </>
  );
}
