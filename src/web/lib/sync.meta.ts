import { useEffect, useRef, useState } from "react";
import type { DashboardMeta, SyncMeta } from "../../server/dashboard.types.ts";
import { getJson } from "@/lib/api.client.ts";

/** Endpoint polled for sync status and tier config. */
export const META_PATH = "/api/meta";
/** Poll period until the first `/api/meta` response tells us the server's `interval_ms`. */
export const META_POLL_FALLBACK_MS = 5_000;

export interface SyncMetaState {
  meta: DashboardMeta | undefined;
  error: Error | undefined;
  /** Starts at 0; +1 each time the server's `changed_at` moves after the first response. */
  dataVersion: number;
}

/** Tracks `changed_at` across polls; the first observation sets the baseline without bumping. */
export interface VersionTracker {
  seen: boolean;
  changedAt: string | null;
  version: number;
}

/** Next tracker state after a poll returned `changedAt`. */
export function trackVersion(t: VersionTracker, changedAt: string | null): VersionTracker {
  if (!t.seen) return { seen: true, changedAt, version: t.version };
  return changedAt === t.changedAt ? t : { seen: true, changedAt, version: t.version + 1 };
}

/** Meta for SyncIndicator with a failed poll folded into `error`, so it shows "Sync failed" even before the first success. */
export function withPollError(meta: SyncMeta | undefined, error: Error | undefined): SyncMeta | undefined {
  if (!error) return meta;
  return { synced_at: null, changed_at: null, interval_ms: META_POLL_FALLBACK_MS, ...meta, error: error.message };
}

/** Error from a failed poll, guaranteed to name the endpoint (fetch network errors don't). */
function pollError(err: unknown): Error {
  if (err instanceof Error && err.message.startsWith(`GET ${META_PATH}`)) return err;
  return new Error(`GET ${META_PATH} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
}

/** Polls `/api/meta` every `interval_ms`; exposes the latest meta, the last poll error, and `dataVersion` for `useApi` ticks. */
export function useSyncMeta(): SyncMetaState {
  const [state, setState] = useState<SyncMetaState>({ meta: undefined, error: undefined, dataVersion: 0 });
  const tracker = useRef<VersionTracker>({ seen: false, changedAt: null, version: 0 });
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = META_POLL_FALLBACK_MS;
    const poll = async () => {
      try {
        const meta = await getJson<DashboardMeta>(META_PATH, {}, ctrl.signal);
        tracker.current = trackVersion(tracker.current, meta.changed_at);
        delay = meta.interval_ms > 0 ? meta.interval_ms : META_POLL_FALLBACK_MS;
        setState({ meta, error: undefined, dataVersion: tracker.current.version });
      } catch (err) {
        if (ctrl.signal.aborted) return; // unmounted; nothing to report
        // Keep the last good meta so the header still shows when we last synced.
        setState((s) => ({ ...s, error: pollError(err) }));
      }
      if (!ctrl.signal.aborted) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);
  return state;
}
