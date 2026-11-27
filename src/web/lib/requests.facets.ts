import type { FacetCount } from "../../server/dashboard.types.ts";
import { STOP_NONE, type RequestFacets } from "../../server/session.detail.types.ts";
import type { FacetDef, FacetOption } from "@/components/facet.filter.tsx";
import { CUSTOM_ROLE_ICON, FAMILY_ICON, KPI_ICON, ROLE_ICON, STOP_ICON, toolIcon } from "@/lib/icon.map.ts";
import type { ModelFamily } from "@/lib/model.tier.ts";
import { REQUEST_DIMS, type RequestDim } from "@/lib/requests.query.ts";
import type { TableState } from "@/lib/table.query.ts";
import { CircleSlash, Wrench } from "lucide-react";

const LABEL: Record<RequestDim, string> = { agent: "Agent", family: "Model", stop: "Stop", tool: "Tool" };
const ICON = { agent: KPI_ICON.agents, family: FAMILY_ICON.other, stop: CircleSlash, tool: Wrench };
const optionIcon = (dim: RequestDim, v: string) =>
  dim === "agent" ? (Object.hasOwn(ROLE_ICON, v) ? ROLE_ICON[v]! : CUSTOM_ROLE_ICON)
  : dim === "family" ? FAMILY_ICON[(Object.hasOwn(FAMILY_ICON, v) ? v : "other") as ModelFamily]
  : dim === "stop" ? (Object.hasOwn(STOP_ICON, v) ? STOP_ICON[v]! : CircleSlash)
  : toolIcon(v);

function options(dim: RequestDim, counts: FacetCount[], selected: string[]): FacetOption[] {
  const known = new Set(counts.map((c) => c.value));
  // A selected value with no rows left still has to be visible so it can be unticked.
  const all = [...counts, ...selected.filter((v) => !known.has(v)).map((value) => ({ value, count: 0 }))];
  return all.map((c) => ({ value: c.value, label: c.value === STOP_NONE ? "none" : c.value, icon: optionIcon(dim, c.value), count: c.count }));
}

/** Toolbar facet definitions from the server's facet counts (empty option lists until the first response). */
export function requestFacets(counts: RequestFacets | undefined, state: TableState, onFilters: (next: TableState["filters"]) => void): FacetDef[] {
  return REQUEST_DIMS.map((dim) => {
    const selected = state.filters[dim] ?? [];
    return { id: dim, label: LABEL[dim], icon: ICON[dim], options: options(dim, counts?.[dim] ?? [], selected), selected, onChange: (next) => onFilters({ ...state.filters, [dim]: next }) };
  });
}
