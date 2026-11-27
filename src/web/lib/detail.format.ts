import { fmtDuration } from "@/lib/format.ts";

/** Tool icons shown in a request row before the "+N" overflow. */
export const TOOL_ICONS_MAX = 3;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock time "HH:mm:ss" (24h) for an ISO timestamp, "—" when missing or invalid. */
export function fmtClock(iso: string | null | undefined): string {
  const d = new Date(iso ?? "");
  return Number.isNaN(d.getTime()) ? "—" : `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Elapsed time between two ISO timestamps ("42m"), "—" when either is missing or invalid. */
export function fmtSpan(first: string | null | undefined, last: string | null | undefined): string {
  const a = Date.parse(first ?? "");
  const b = Date.parse(last ?? "");
  return Number.isNaN(a) || Number.isNaN(b) ? "—" : fmtDuration(b - a);
}

/** First `max` tool names to render as icons, plus the names that overflow into "+N". */
export function splitTools(tools: readonly string[], max = TOOL_ICONS_MAX): { shown: string[]; rest: string[] } {
  return { shown: tools.slice(0, max), rest: tools.slice(max) };
}
