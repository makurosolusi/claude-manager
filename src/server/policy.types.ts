/** /api/policy contract (spec PLAN/08 §5). Shared by the server routes and the web client; pure types. */
import type { AuditFacets, AuditRow as DbAuditRow, AuditSummaryRow } from "../db/policy.repository.ts";
import type { SettingsChange } from "../policy/policy.apply.ts";
import type { Capability, Decision, PolicyConfig, PolicyRow, PresetName } from "../policy/policy.types.ts";

export type { AuditFacets, AuditSummaryRow, Capability, Decision, PolicyConfig, PolicyRow, PresetName, SettingsChange };

/** not_set_up: no `policy` in config.json · disabled: stored but off · drift: on but not enforced · blocked: managed settings win. */
export type PolicyStatus = "not_set_up" | "enforced" | "disabled" | "drift" | "blocked";

/** GET /api/policy. `etag` is the If-Match for PATCH/DELETE; PUT takes the etag from its preview. */
export interface PolicyResponse {
  status: PolicyStatus;
  /** Why status is drift or blocked (first one is the banner text); empty otherwise. */
  reasons: string[];
  config: PolicyConfig | null;
  /** Effective matrix; the Balanced preview when not set up. */
  rows: PolicyRow[];
  /** Settings file holding the applied policy; null when nothing is applied. */
  settings_path: string | null;
  /** Registered hook as one string (`<command> <args…>`); null when nothing is applied. */
  hook_command: string | null;
  installed_scopes: ("user" | "project")[];
  warnings: string[];
  /** Decision counts per role over the last 30 days (not in §5; feeds the banner and agent surfaces). */
  audit_summary: AuditSummaryRow[];
  etag: string;
}

/** Body of POST /api/policy/preview and PUT /api/policy (PUT adds `confirm: true`). Project scope uses the dashboard's git root. */
export interface PolicyInput {
  preset: PresetName;
  scope: "user" | "project";
  overrides?: PolicyConfig["overrides"];
  defaultMode?: "acceptEdits" | null;
  testCommands?: string[];
  escalate?: boolean;
}

export type PolicyPutInput = PolicyInput & { confirm: true };

/** PATCH /api/policy body: worker escalation on or off. */
export interface PolicyEscalatePatch { escalate: boolean }

/** PATCH /api/policy/rows/:row body. */
export type PolicyRowPatch = Partial<Record<Capability, Decision>>;

/** POST /api/policy/preview; writes nothing. `etag` is the If-Match for the PUT. */
export interface PolicyPreview { changes: SettingsChange[]; settings_path: string; rows: PolicyRow[]; etag: string }

/** PUT, PATCH and DELETE result. */
export interface PolicyWriteResult { policy: PolicyResponse; changes: SettingsChange[]; etag: string }

/** One audit table row (no agent_id: the UI never shows it). */
export type AuditRow = Omit<DbAuditRow, "agent_id">;

/** GET /api/policy/audit?q&role&decision&tool&cap&since&page&size (size ≤ 100, default 50; role/decision/tool/cap repeatable). */
export interface AuditResponse { items: AuditRow[]; total: number; page: number; size: number; facets: AuditFacets }
