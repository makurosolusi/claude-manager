import { normalizeModel } from "./model.tier.ts";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
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

/** Token counts in compact form: 1234567 → "1.2M". */
export const fmtTokens = (n: number) => compact.format(n);

/** Plain integer with thousands separators. */
export const fmtInt = (n: number) => integer.format(n);

/** USD amount; sub-cent values keep 2 significant digits instead of rounding to $0.00. */
export const fmtUsd = (n: number) => (n > 0 && n < 0.01 ? usdSmall.format(n) : usd.format(n));

/** Local date-time for an ISO timestamp, "—" when missing or invalid. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
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

/** A 0..1 ratio as a percentage with one decimal: 0.912 → "91.2%". */
export const fmtPct = (ratio: number) => pct.format(ratio);

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

/** Last path segment of a project cwd, for compact display. */
export const shortPath = (p: string | null) => (p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : "—");
