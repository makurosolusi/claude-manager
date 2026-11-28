import type { Database } from "bun:sqlite";
import type { FacetCount, Page } from "../server/dashboard.types.ts";
import { paged, type PageQuery } from "./dashboard.repository.ts";
import { listParam, type Params } from "./stats.repository.ts";

/** One hook decision; carries no tool input, path or command by design. */
export interface AuditRow {
  ts: string;
  session_id: string | null;
  agent_id: string | null;
  role: string;
  tool: string;
  cap: string | null;
  decision: string;
  rule: string;
  mode: string | null;
}

export interface AuditFilter {
  /** Case-insensitive substring over role, tool and rule. */
  q?: string;
  since?: string;
  roles?: string[];
  decisions?: string[];
  tools?: string[];
  caps?: string[];
}

export interface AuditFacets { decision: FacetCount[]; role: FacetCount[]; capability: FacetCount[]; tool: FacetCount[] }
export type AuditPage = Page<AuditRow> & { facets: AuditFacets };
export interface AuditSummaryRow { role: string; decision: string; count: number }

type Dim = "role" | "decision" | "cap" | "tool";

const IN = (col: string, param: string) => `($${param} IS NULL OR ${col} IN (SELECT value FROM json_each($${param})))`;
const FACET_LIMIT = 50;
const SUMMARY_LIMIT = 1000; // roles x decisions; bounded by the number of agents, never by row count
const COLS = "ts, session_id, agent_id, role, tool, cap, decision, rule, mode";

function where(skip?: Dim) {
  const on = (d: Dim, c: string, p: string) => (d === skip ? "1" : IN(c, p));
  return `ts >= $since AND ($q IS NULL OR instr(lower(role || ' ' || tool || ' ' || rule), lower($q)) > 0)
    AND ${on("role", "role", "roles")} AND ${on("decision", "decision", "decisions")}
    AND ${on("cap", "cap", "caps")} AND ${on("tool", "tool", "tools")}`;
}

function bind(f: AuditFilter): Params {
  return {
    since: f.since ?? "",
    q: f.q?.trim() || null,
    roles: listParam(f.roles),
    decisions: listParam(f.decisions),
    caps: listParam(f.caps),
    tools: listParam(f.tools),
  };
}

// A facet counts rows under every other filter but its own, so picking a value never hides its siblings.
function facet(db: Database, col: string, dim: Dim, params: Params): FacetCount[] {
  return db
    .query<FacetCount, Params>(
      `SELECT ${col} AS value, COUNT(*) AS count FROM policy_decisions WHERE ${where(dim)} AND ${col} IS NOT NULL
       GROUP BY ${col} ORDER BY count DESC, value LIMIT ${FACET_LIMIT}`,
    )
    .all(params);
}

/** Server-side page of audit rows (newest first) with facet counts for decision, role, capability and tool. */
export function auditPage(db: Database, f: AuditFilter, page: PageQuery): AuditPage {
  const params = bind(f);
  const p = paged<AuditRow>(
    db,
    page,
    `SELECT ${COLS} FROM policy_decisions WHERE ${where()} ORDER BY ts DESC, line_hash LIMIT $limit OFFSET $offset`,
    `SELECT COUNT(*) AS n FROM policy_decisions WHERE ${where()}`,
    params,
  );
  const facets = {
    decision: facet(db, "decision", "decision", params),
    role: facet(db, "role", "role", params),
    capability: facet(db, "cap", "cap", params),
    tool: facet(db, "tool", "tool", params),
  };
  return { ...p, facets };
}

/** Decision counts per role since `since` (ISO); feeds the Agents permission surfaces and the policy banner. */
export function auditSummary(db: Database, since: string): AuditSummaryRow[] {
  return db
    .query<AuditSummaryRow, Params>(
      `SELECT role, decision, COUNT(*) AS count FROM policy_decisions WHERE ts >= $since
       GROUP BY role, decision ORDER BY role, decision LIMIT ${SUMMARY_LIMIT}`,
    )
    .all({ since });
}
