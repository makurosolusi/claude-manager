import { fmtInt, fmtModel } from "./format.ts";

/** Why a request can be served by another model, and what to do about it (shared tail of every rerouted tooltip). */
export const REROUTE_HINT = "A proxy or gateway (ANTHROPIC_BASE_URL) may be remapping models. Run `claude-manager doctor`.";

/** Tooltip text: what the client asked for vs what actually answered. */
export const rerouteNote = (requested: string, served: string) => `Requested ${fmtModel(requested)}, served by ${fmtModel(served)}. ${REROUTE_HINT}`;

/** "12 of 40 rerouted" summary for a count and the request total it is out of. */
export const fmtRerouted = (count: number, total: number) => `${fmtInt(count)} of ${fmtInt(total)} rerouted`;

/** Tooltip of an aggregate marker (session, role); null when nothing was rerouted, so no marker is drawn. */
export const rerouteMarkNote = (count: number, total: number): string | null =>
  count > 0 ? `${fmtInt(count)} of ${fmtInt(total)} requests rerouted. ${REROUTE_HINT}` : null;

/** Chip label: "3 rerouted". */
export const rerouteChipLabel = (count: number) => `${fmtInt(count)} rerouted`;
