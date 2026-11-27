import { Shuffle } from "lucide-react";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { fmtInt } from "@/lib/format.ts";
import { REROUTE_HINT, rerouteChipLabel, rerouteMarkNote, rerouteNote } from "@/lib/reroute.ts";

/** Warning badge for a request served by another model than requested; hover/focus shows both models. */
export function RerouteBadge({ requested, served }: { requested: string; served: string }) {
  return (
    <Tooltip focusable content={rerouteNote(requested, served)}>
      <ToneBadge tone="warning" icon={Shuffle}>
        rerouted
      </ToneBadge>
    </Tooltip>
  );
}

/** "N rerouted" warning chip for a session header; the tooltip explains what rerouted means. */
export function RerouteChip({ count }: { count: number }) {
  return (
    <Tooltip focusable side="bottom" className="max-w-full" content={`${fmtInt(count)} requests were served by a model other than the one requested. ${REROUTE_HINT}`}>
      <ToneBadge tone="warning" icon={Shuffle}>
        {rerouteChipLabel(count)}
      </ToneBadge>
    </Tooltip>
  );
}

/** Icon-only marker beside a model (nothing when no request was rerouted); tooltip "N of M requests rerouted". */
export function RerouteMark({ count, total }: { count: number; total: number }) {
  const note = rerouteMarkNote(count, total);
  if (!note) return null;
  return (
    <Tooltip focusable content={note}>
      <Shuffle role="img" aria-label={note} className={`size-3.5 shrink-0 ${TONE_CLASSES.warning.text}`} />
    </Tooltip>
  );
}

/** Rerouted request count in the warning tone; "—" when zero. `total` adds the "N of M" tooltip. */
export function ReroutedCount({ count, total }: { count: number; total?: number }) {
  if (!count) return <span className="text-fg-subtle">—</span>;
  const note = total === undefined ? null : rerouteMarkNote(count, total);
  const n = <span className={`tabular-nums ${TONE_CLASSES.warning.text}`}>{fmtInt(count)}</span>;
  return note ? <Tooltip focusable content={note}>{n}</Tooltip> : n;
}

/** KPI hint "N rerouted" linking to the page where the sessions can be inspected; same tooltip copy as the other markers. */
export function ReroutedLink({ count, href }: { count: number; href: string }) {
  return (
    <Tooltip content={`${REROUTE_HINT} Open Sessions to find them.`} side="bottom" className="max-w-full">
      <a href={href} className={`inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring ${TONE_CLASSES.warning.text}`}>
        <Shuffle aria-hidden className="size-3" />
        {rerouteChipLabel(count)}
      </a>
    </Tooltip>
  );
}
