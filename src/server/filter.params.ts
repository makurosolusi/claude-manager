/** HTTP statuses the dashboard API answers with on client errors. */
export const HTTP = { badRequest: 400, forbidden: 403, notFound: 404, notAllowed: 405 } as const;

/** Client error mapped straight to an HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Max values per repeated facet param. */
export const MAX_FACET_VALUES = 20;
/** Max characters per facet value. */
export const MAX_FACET_CHARS = 512;

/** 400 error for a bad query parameter. */
export const bad = (message: string) => new HttpError(HTTP.badRequest, message);

/** Repeated `name=` values, deduplicated and bounded; `allowed` restricts them to an enum. undefined when absent. */
export function listParam<T extends string = string>(url: URL, name: string, allowed?: readonly T[]): T[] | undefined {
  const raw = url.searchParams.getAll(name).filter((v) => v !== "");
  if (!raw.length) return undefined;
  const values = [...new Set(raw)];
  if (values.length > MAX_FACET_VALUES) throw bad(`invalid ${name} "${values.length} values": use at most ${MAX_FACET_VALUES} values`);
  for (const v of values) {
    if (allowed && !(allowed as readonly string[]).includes(v)) throw bad(`invalid ${name} "${v}": use one of ${allowed.join(", ")}`);
    if (v.length > MAX_FACET_CHARS) throw bad(`invalid ${name} "${v.slice(0, 20)}…": use at most ${MAX_FACET_CHARS} characters`);
  }
  return values as T[];
}

/** Single enum param (`by`, `sort`, …) with a default; 400 on an unknown value. */
export function enumParam<T extends string>(url: URL, name: string, allowed: readonly T[], fallback?: T): T {
  const v = url.searchParams.get(name) ?? fallback;
  if (v === undefined || !(allowed as readonly string[]).includes(v)) throw bad(`invalid ${name} "${v ?? ""}": use one of ${allowed.join(", ")}`);
  return v as T;
}
