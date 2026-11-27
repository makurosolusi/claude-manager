const HOUR_MS = 3_600_000;

/** Time-range choices for the `since` filter, in hours (null = all time). */
export const RANGES = { "24h": 24, "7d": 7 * 24, "30d": 30 * 24, "90d": 90 * 24, all: null } as const;
export type Range = keyof typeof RANGES;
export const DEFAULT_RANGE: Range = "30d";

/** Range from a URL param; missing or unknown values fall back to the default. */
export const parseRange = (v: string | null | undefined): Range => (v && Object.hasOwn(RANGES, v) ? (v as Range) : DEFAULT_RANGE);

/** ISO lower bound for a range; "all" maps to the Unix epoch so the server never applies its own default. */
export function sinceFor(range: Range, now = Date.now()): string {
  const hours = RANGES[range];
  return new Date(hours === null ? 0 : now - hours * HOUR_MS).toISOString();
}
