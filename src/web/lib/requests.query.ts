import type { TableSpec } from "@/lib/table.query.ts";

/** Facet / group dimensions of the requests table (names match the API params). */
export const REQUEST_DIMS = ["agent", "family", "stop", "tool"] as const;
/** A facet / group dimension of the requests table. */
export type RequestDim = (typeof REQUEST_DIMS)[number];

/** URL state of the requests table: sorts, groups and facets accepted by /api/sessions/:id/requests. */
export const REQUEST_SPEC: TableSpec = {
  sorts: ["ts", "cost", "tokens", "context"],
  defaultSort: "ts",
  defaultDir: "desc",
  groups: ["none", "agent", "family", "stop"],
  facets: { agent: "free", family: ["opus", "sonnet", "haiku", "other"], stop: "free", tool: "free" },
};

/** Requests (or, with `groupsBy`, groups) endpoint path of one session; pass filters in the `useApi` query. */
export function requestsPath(id: string, groupsBy?: boolean): string {
  return `/api/sessions/${encodeURIComponent(id)}/requests${groupsBy ? "/groups" : ""}`;
}
