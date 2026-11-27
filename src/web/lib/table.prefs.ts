export type Density = "compact" | "comfortable";
export const DEFAULT_DENSITY: Density = "compact";
const DENSITY_KEY = "cm-density";
const colsKey = (id: string) => `cm-cols:${id}`;

// Storage can throw (private window, blocked site data) or hold junk: every access falls back to defaults.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`table prefs: could not save ${key}`, e);
  }
}

/** Hidden column ids saved for table `id` (empty when unset or unreadable). */
export function loadHiddenCols(id: string): string[] {
  try {
    const v: unknown = JSON.parse(read(colsKey(id)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Saves hidden column ids for table `id`. */
export function saveHiddenCols(id: string, hidden: readonly string[]): void {
  write(colsKey(id), JSON.stringify(hidden));
}

/** Saved row density, or the default. */
export function loadDensity(): Density {
  const v = read(DENSITY_KEY);
  return v === "compact" || v === "comfortable" ? v : DEFAULT_DENSITY;
}

/** Saves the row density. */
export function saveDensity(d: Density): void {
  write(DENSITY_KEY, d);
}
