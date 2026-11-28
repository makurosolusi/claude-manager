import type { SyncMeta } from "../../server/dashboard.types.ts";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/cn.ts";
import { fmtDuration } from "@/lib/format.ts";

/** Sync counts as stalled after this many missed intervals. */
export const SYNC_STALL_FACTOR = 3;

type SyncState = "connecting" | "ok" | "stalled" | "failed";

const DOT: Record<SyncState, string> = { connecting: "bg-muted-foreground", ok: "bg-ok", stalled: "bg-warn", failed: "bg-destructive" };
const STATUS: Record<SyncState, string> = { connecting: "Connecting", ok: "Synced", stalled: "Sync stalled", failed: "Sync failed" };

/** State of the background sync for `meta` at time `now`. */
export function syncState(meta: SyncMeta | undefined, now: number): SyncState {
  if (!meta) return "connecting";
  if (meta.error) return "failed";
  const at = meta.synced_at ? Date.parse(meta.synced_at) : NaN;
  if (Number.isNaN(at)) return "connecting";
  return now - at > SYNC_STALL_FACTOR * meta.interval_ms ? "stalled" : "ok";
}

/** Header status: colored dot + text ("Synced 3s ago", "Sync stalled · 2m", "Sync failed"); color is never the only signal. */
export function SyncIndicator({ meta, now }: { meta: SyncMeta | undefined; now: number }) {
  const state = syncState(meta, now);
  const age = meta?.synced_at ? fmtDuration(now - Date.parse(meta.synced_at)) : "";
  const text = state === "connecting" ? "Connecting…" : state === "ok" ? `Synced ${age} ago` : state === "stalled" ? `Sync stalled · ${age}` : "Sync failed";
  const body = (
    <span title={text} className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", state === "ok" && meta?.warnings?.length ? "bg-warn" : DOT[state])} />
      <span aria-hidden className="max-sm:hidden">{text}</span>
      {/* Announce status changes only, not the ticking age. */}
      <span role="status" className="sr-only">
        {STATUS[state]}
      </span>
    </span>
  );
  // A failed sync shows its error; a successful one with warnings (e.g. audit not ingested) lists them instead.
  const note = state === "failed" ? meta?.error : state === "ok" && meta?.warnings?.length ? `Sync warnings: ${meta.warnings.join("; ")}` : undefined;
  return note ? (
    <Tooltip focusable side="bottom" content={note}>
      {body}
    </Tooltip>
  ) : (
    body
  );
}
