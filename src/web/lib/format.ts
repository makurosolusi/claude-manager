import { normalizeModel } from "./model.tier.ts";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 2 });

const timeShort = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const pct = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Below this age a timestamp reads "just now". */
const JUST_NOW_MS = 45 * SEC;
/** Up to this age a timestamp is shown in days ("3d ago"); older ones get a date. */
const RELATIVE_DAYS_MAX = 7;

/** Counts from this size up use the compact form. */
const COMPACT_MIN = 1000;

/** Token counts: integers below 1K, otherwise compact with one decimal ("2.0B", "1.3B") so a column never jitters. */
export const fmtTokens = (n: number) => (Math.abs(n) < COMPACT_MIN ? integer.format(n) : compact.format(n));

/** Plain integer with thousands separators. */
export const fmtInt = (n: number) => integer.format(n);

/** USD amount; sub-cent values keep 2 significant digits instead of rounding to $0.00. */
export const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? usdSmall.format(n) : usd.format(n));

/** Chart-axis USD: whole dollars from $1 ("$800"), compact from $1K ("$1.2K"), sub-dollar values keep cents. */
export function fmtUsdAxis(n: number): string {
  if (n >= COMPACT_MIN) return usdCompact.format(n);
  return n >= 1 || n === 0 ? usdWhole.format(n) : usd.format(n);
}

/** Local 12h date-time for an ISO timestamp ("Nov 27, 11:05 PM"; year only when not the current one), "—" when missing or invalid. */
export function fmtTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear() === new Date(now).getFullYear() ? monthDay.format(d) : monthDayYear.format(d)}, ${timeShort.format(d)}`;
}

/** Age of an ISO timestamp relative to `now`: "just now", "12m ago", "5h ago", "3d ago", "Nov 3", "Nov 3, 2025". */
export function fmtRelative(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const age = now - t; // negative (clock skew, future ts) reads as "just now"
  if (age < JUST_NOW_MS) return "just now";
  if (age < HOUR) return `${Math.max(1, Math.floor(age / MIN))}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < RELATIVE_DAYS_MAX * DAY) return `${Math.floor(age / DAY)}d ago`;
  const d = new Date(t);
  return d.getFullYear() === new Date(now).getFullYear() ? monthDay.format(d) : monthDayYear.format(d);
}

/** Short elapsed duration: 3000 → "3s", 125000 → "2m", 7200000 → "2h", 3 days → "3d"; negatives clamp to "0s". */
export function fmtDuration(ms: number): string {
  const t = Math.max(0, ms);
  if (t < MIN) return `${Math.floor(t / SEC)}s`;
  if (t < HOUR) return `${Math.floor(t / MIN)}m`;
  if (t < DAY) return `${Math.floor(t / HOUR)}h`;
  return `${Math.floor(t / DAY)}d`;
}

/** Last two path segments of a project cwd ("/Users/me/acme/web" → "acme/web"), "—" when missing. */
export function fmtProject(cwd: string | null | undefined): string {
  if (!cwd) return "—";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts.slice(-2).join("/") : cwd;
}

/** Short model name without vendor prefix or date: "claude-opus-4-7-20260101" → "opus-4-7". */
export const fmtModel = (id: string | null | undefined) => (id ? normalizeModel(id).replace(/^claude-/, "") : "—");

/** "1 request" / "3 requests": `n` formatted with `fmtInt`, noun pluralised with a plain "s". */
export const plural = (n: number, noun: string) => `${fmtInt(n)} ${noun}${n === 1 ? "" : "s"}`;

/** Positive shares below this read "<0.1%" instead of a false "0.0%". */
const PCT_FLOOR = 0.001;

/** A 0..1 ratio as a percentage with one decimal: 0.912 → "91.2%"; tiny non-zero ratios → "<0.1%". */
export const fmtPct = (ratio: number) => (ratio > 0 && ratio < PCT_FLOOR ? "<0.1%" : pct.format(ratio));

/** Signed percent change for display: 0 decimals from 10% up ("24%"), 1 below ("3.4%"). */
export const fmtDeltaPct = (v: number) => `${Math.abs(v) >= DELTA_WHOLE_PCT ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`;
const DELTA_WHOLE_PCT = 10;

/** Percent change from `prev` to `cur`; null when there is no usable baseline (missing or zero). */
export function fmtDelta(cur: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Share of prompt tokens served from cache: cache_read / (input + cache_read + cache_write); 0 when no prompt tokens. */
export function cacheHitRate(u: { input: number; cache_read: number; cache_write: number }): number {
  const prompt = u.input + u.cache_read + u.cache_write;
  return prompt > 0 ? u.cache_read / prompt : 0;
}

