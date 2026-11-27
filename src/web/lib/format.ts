const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 2 });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

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

/** Last path segment of a project cwd, for compact display. */
export const shortPath = (p: string | null) => (p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : "—");
