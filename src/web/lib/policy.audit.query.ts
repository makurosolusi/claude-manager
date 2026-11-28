import type { AuditResponse } from "../../server/policy.types.ts";
import type { Query } from "@/lib/api.client.ts";
import { plural } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { DEFAULT_RANGE, type Range } from "@/lib/range.ts";
import { tableParams, type TableSpec, type TableState } from "@/lib/table.query.ts";

export const POLICY_AUDIT_PATH = "/policy/audit";
/** Facet ids; each is the URL key and the API param. Capability is not offered: the API has no filter for it. */
export const AUDIT_FACET_IDS = ["decision", "role", "tool"] as const;
export const AUDIT_DECISIONS = ["allow", "ask", "deny", "error"] as const;

/** URL contract of the audit table (no sorting or grouping: the server orders by time). */
export const AUDIT_SPEC: TableSpec = {
  sorts: [], defaultSort: "ts", defaultDir: "desc", groups: [],
  facets: { decision: AUDIT_DECISIONS, role: "free", tool: "free" },
};

/** `/api/policy/audit` request for the table state; the endpoint takes `size`, not `pageSize`. `range` is ignored by the server and keeps a range change a new resource. */
export function auditApi(since: string, s: TableState, range: Range): { path: string; query: Query } {
  const query: Query = { since, range, q: s.q || undefined, page: s.page, size: s.size };
  for (const id of AUDIT_FACET_IDS) query[id] = s.filters[id] ?? [];
  return { path: "/api/policy/audit", query };
}

export const auditHref = (s: TableState, range: Range): string =>
  hashHref(POLICY_AUDIT_PATH, { range: range === DEFAULT_RANGE ? undefined : range, ...tableParams(s, AUDIT_SPEC) });

/** Facet options (with server counts) for one dimension. */
export function auditFacet(data: AuditResponse | undefined, id: (typeof AUDIT_FACET_IDS)[number]): { value: string; count: number }[] {
  return (data?.facets[id] ?? []).map((f) => ({ value: f.value, count: f.count }));
}

/** Subtitle count; "—" on error so a stale total is never shown. */
export function auditCountLabel(total: number | undefined, failed: boolean): string {
  return failed ? "—" : total === undefined ? "Loading…" : plural(total, "decision");
}
