import { Shuffle } from "lucide-react";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { fmtInt, fmtModel } from "@/lib/format.ts";

/** Tooltip text: what the client asked for vs what actually answered. */
export const rerouteNote = (requested: string, served: string) => `Requested ${fmtModel(requested)}, served by ${fmtModel(served)}`;

/** "12 of 40 rerouted" summary for a count and the request total it is out of. */
export const fmtRerouted = (count: number, total: number) => `${fmtInt(count)} of ${fmtInt(total)} rerouted`;

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
