import type { AgentRow } from "../../server/agents.types.ts";
import type { PolicyResponse, PolicyRow } from "../../server/policy.types.ts";
import { CAPABILITIES } from "../../policy/policy.presets.ts";
import { useApi } from "./api.client.ts";

/** `GET /api/policy` with the shared refresh tick; `data` stays undefined while loading or on error (surfaces then render nothing). */
export const usePolicy = (tick: number) => useApi<PolicyResponse>("/api/policy", {}, tick);

/** Matrix row governing an agent: its own named row, else the `unknown` row (externals and roles the policy doesn't list). */
export function rowForAgent(rows: readonly PolicyRow[] | undefined, agent: Pick<AgentRow, "name" | "kind">): PolicyRow | undefined {
  if (!rows) return undefined;
  const unknown = rows.find((r) => r.kind === "unknown");
  if (agent.kind === "external") return unknown;
  return rows.find((r) => r.row === agent.name && r.kind !== "unknown") ?? unknown;
}

/** Tooltip text listing every cell, e.g. "read: allow, edit: ask (edited), …". */
export const cellsTitle = (row: PolicyRow): string =>
  CAPABILITIES.map((c) => `${c}: ${row.cells[c].decision}${row.cells[c].source === "override" ? " (edited)" : ""}`).join(", ");
