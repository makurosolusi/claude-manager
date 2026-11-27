import { useSyncExternalStore } from "react";

/** Refresh period for relative timestamps ("5m ago"). */
export const NOW_TICK_MS = 30_000;

// One shared interval for every subscriber, so N RelativeTime cells cost one timer.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) now = Date.now(); // idle since last unsubscribe: don't start from a stale value
  timer ??= setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, NOW_TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Current epoch ms, re-rendering every NOW_TICK_MS via one shared interval. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
