import { useSyncExternalStore } from "react";

/** Refresh period for relative timestamps ("5m ago"). */
export const NOW_TICK_MS = 30_000;
/** Refresh period for second-granularity ages ("Synced 3s ago" in the header). */
export const SECOND_TICK_MS = 1_000;

interface Clock {
  now: number;
  timer: ReturnType<typeof setInterval> | undefined;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
}

// One shared interval per tick period, so N subscribers on the same period cost one timer.
const clocks = new Map<number, Clock>();

function clockFor(tickMs: number): Clock {
  let c = clocks.get(tickMs);
  if (c) return c;
  const clock: Clock = {
    now: Date.now(),
    timer: undefined,
    listeners: new Set(),
    subscribe(listener) {
      clock.listeners.add(listener);
      if (!clock.timer) clock.now = Date.now(); // idle since last unsubscribe: don't start from a stale value
      clock.timer ??= setInterval(() => {
        clock.now = Date.now();
        for (const l of clock.listeners) l();
      }, tickMs);
      return () => {
        clock.listeners.delete(listener);
        if (clock.listeners.size === 0) {
          clearInterval(clock.timer);
          clock.timer = undefined;
        }
      };
    },
  };
  clocks.set(tickMs, clock);
  return clock;
}

/** Current epoch ms, re-rendering every `tickMs` via one interval shared by all callers of that period. */
export function useNow(tickMs: number = NOW_TICK_MS): number {
  const clock = clockFor(tickMs);
  return useSyncExternalStore(clock.subscribe, () => clock.now);
}
