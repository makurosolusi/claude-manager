import { CAPABILITIES, OWNER_ONLY_CAPS } from "../../policy/policy.presets.ts";
import type { Capability, Decision } from "../../policy/policy.types.ts";
import type { PolicyRow } from "../../server/policy.types.ts";

export type RowPatch = Partial<Record<Capability, Decision>>;
/** Matrix editor staging: the server rows plus the cells the user changed so far. */
export interface Staging { initial: PolicyRow[]; edits: Record<string, RowPatch> }
export interface PatchRequest { row: string; body: RowPatch }

export const DECISION_LABEL: Record<Decision, string> = { allow: "Allow", ask: "Ask", deny: "Deny", default: "Default" };
/** Short noun per capability, used in one-line summaries. */
export const CAP_NOUN: Record<Capability, string> = {
  read: "reads", edit: "edits", test: "tests", shell: "shell", web: "web", agents: "agents", git: "git", push: "push", mcp: "MCP",
};
const SUMMARY_VERB: Record<Capability, string> = {
  read: "Reads files", edit: "Edits code", test: "runs tests", shell: "runs shell", web: "uses the web", agents: "spawns agents",
  git: "commits locally", push: "pushes", mcp: "uses MCP tools",
};

const isOwnerOnly = (cap: Capability) => OWNER_ONLY_CAPS.includes(cap);
/** Options a cell's select may offer; owner-only capabilities never get Allow. */
export const decisionOptions = (cap: Capability): Decision[] =>
  (["allow", "ask", "deny", "default"] as const).filter((d) => !(d === "allow" && isOwnerOnly(cap)));

export const newStaging = (rows: PolicyRow[]): Staging => ({ initial: rows, edits: {} });

const initialDecision = (s: Staging, row: string, cap: Capability): Decision | undefined =>
  s.initial.find((r) => r.row === row)?.cells[cap]?.decision;

/** Stages one cell edit. Owner-only allow, unknown rows and no-op edits leave the staging unchanged. */
export function stageCell(s: Staging, row: string, cap: Capability, decision: Decision): Staging {
  const before = initialDecision(s, row, cap);
  if (before === undefined || (decision === "allow" && isOwnerOnly(cap))) return s;
  const patch = { ...s.edits[row] };
  if (decision === before) delete patch[cap]; else patch[cap] = decision;
  const edits = { ...s.edits };
  if (Object.keys(patch).length) edits[row] = patch; else delete edits[row];
  return { ...s, edits };
}

export const isDirty = (s: Staging): boolean => Object.keys(s.edits).length > 0;
export const discardStaging = (s: Staging): Staging => newStaging(s.initial);

/** Rows with staged edits applied; an edited cell is marked as an override. */
export const stagedRows = (s: Staging): PolicyRow[] =>
  s.initial.map((r) => {
    const patch = s.edits[r.row];
    if (!patch) return r;
    const cells = { ...r.cells };
    for (const cap of Object.keys(patch) as Capability[]) cells[cap] = { decision: patch[cap]!, source: "override" };
    return { ...r, cells };
  });

/** Minimal PATCH bodies (one per changed row, changed cells only) to turn `initial` into `staged`; owner-only allow is never emitted. */
export function diffToPatches(initial: PolicyRow[], staged: PolicyRow[]): PatchRequest[] {
  const byName = new Map(initial.map((r) => [r.row, r]));
  const out: PatchRequest[] = [];
  for (const row of staged) {
    const base = byName.get(row.row);
    if (!base) continue;
    const body: RowPatch = {};
    for (const cap of CAPABILITIES) {
      const d = row.cells[cap].decision;
      if (d !== base.cells[cap].decision && !(d === "allow" && isOwnerOnly(cap))) body[cap] = d;
    }
    if (Object.keys(body).length) out.push({ row: row.row, body });
  }
  return out;
}

/** "Allow" or "Allow (edited)": the effective decision and whether it comes from a preset or an override. */
export function effectiveLabel(row: PolicyRow, cap: Capability): string {
  const c = row.cells[cap];
  return c.source === "override" ? `${DECISION_LABEL[c.decision]} (edited)` : DECISION_LABEL[c.decision];
}

const capsWith = (row: PolicyRow, d: Decision) => CAPABILITIES.filter((c) => row.cells[c].decision === d);

/** Plain-language row summary, e.g. "Reads files, edits code, runs tests, asks before git, shell". */
export function summarizeRow(row: PolicyRow): string {
  const allow = capsWith(row, "allow").map((c) => SUMMARY_VERB[c].replace(/^./, (ch) => ch.toLowerCase()));
  const ask = capsWith(row, "ask").map((c) => CAP_NOUN[c]);
  const deny = capsWith(row, "deny").map((c) => CAP_NOUN[c]);
  const parts = [...allow];
  if (ask.length) parts.push(`asks before ${ask.join(", ")}`);
  if (deny.length) parts.push(`never ${deny.join(", ")}`);
  if (!parts.length) return "Follows Claude Code defaults";
  return parts.join(", ").replace(/^./, (ch) => ch.toUpperCase());
}

/** Count line for the narrow-screen row header, e.g. "4 allow · 3 ask · 1 deny" (zero counts omitted). */
export function countLine(row: PolicyRow): string {
  const parts = (["allow", "ask", "deny"] as const).map((d) => [capsWith(row, d).length, d] as const).filter(([n]) => n > 0);
  return parts.length ? parts.map(([n, d]) => `${n} ${d}`).join(" · ") : "all default";
}

const KIND_RANK: Record<PolicyRow["kind"], number> = { main: 0, preset: 1, custom: 1, unknown: 2 };
const TIER_RANK: Record<string, number> = { think: 0, work: 1, basic: 2 };

/** Display order: main, then roles by tier (optional `tiers` map, row → tier) and name, then unknown. */
export function rowsForDisplay(rows: PolicyRow[], tiers: Record<string, string | undefined> = {}): PolicyRow[] {
  const rank = (r: PolicyRow) => (KIND_RANK[r.kind] === 1 ? TIER_RANK[tiers[r.row] ?? ""] ?? 3 : 0);
  return [...rows].sort((a, b) =>
    KIND_RANK[a.kind] - KIND_RANK[b.kind] || rank(a) - rank(b) || a.row.localeCompare(b.row));
}
