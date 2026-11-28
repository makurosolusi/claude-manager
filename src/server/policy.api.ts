import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { CliError, type ErrorReason } from "../cli.error.ts";
import { checkPolicy } from "../commands/doctor.policy.ts";
import { parseSince } from "../commands/stats.command.ts";
import { StaleConfigError } from "../config/config.apply.ts";
import { type Config, loadConfig } from "../config/config.store.ts";
import { auditPage, auditSummary } from "../db/policy.repository.ts";
import { POLICY_AUDIT_DAYS } from "../ingest/policy.audit.ingest.ts";
import { loadManifest, type Manifest } from "../install/install.manifest.ts";
import { parseSettings, readText } from "../install/install.target.ts";
import { currentEtag } from "../policy/policy.apply.ts";
import { effectivePolicy } from "../policy/policy.effective.ts";
import { blockingKeys, managedSettingsPaths } from "../policy/policy.managed.ts";
import type { HookGroup } from "../install/settings.lists.ts";
import { MAX_QUERY_CHARS } from "./dashboard.params.ts";
import { bad, HttpError, listParam } from "./filter.params.ts";
import type { AuditResponse, PolicyResponse, PolicyStatus } from "./policy.types.ts";

export const STATUS = { ok: 200, badRequest: 400, notFound: 404, conflict: 409, stale: 412, noEtag: 428, internal: 500 } as const;
const REASON_STATUS: Record<ErrorReason, number> = { invalid: STATUS.badRequest, not_found: STATUS.notFound, conflict: STATUS.conflict, server: STATUS.internal };
const POLICY_PATH = /^\/api\/policy(?:\/.*)?$/;
const AUDIT_DEFAULT_SIZE = 50;
const AUDIT_MAX_SIZE = 100;

export const fail = (status: number, error: string) => Response.json({ error }, { status });
export const trim = (pathname: string) => pathname.replace(/\/+$/, "");
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** True for /api/policy and everything under it. */
export const isPolicyPath = (pathname: string) => POLICY_PATH.test(trim(pathname));

/** Maps a service error to its status; anything unexpected is a 500 that names the operation. */
export function errorResponse(err: unknown, what: string): Response {
  if (err instanceof StaleConfigError) return fail(STATUS.stale, err.message);
  if (err instanceof HttpError) return fail(err.status, err.message);
  if (err instanceof CliError) return fail(REASON_STATUS[err.reason], err.message);
  return fail(STATUS.internal, `${what}: ${reason(err)}`);
}

/** Managed settings files that block hooks or rules, as reasons; an unreadable managed file is not a block. */
export async function managedBlocks(paths = managedSettingsPaths()): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths.filter((p) => existsSync(p))) {
    const settings = parseSettings(await readText(path), path);
    const keys = blockingKeys(settings);
    if (keys.length) out.push(`Blocked by your organization's managed settings (${path} sets ${keys.join(", ")})`);
  }
  return out;
}

async function status(config: Config, manifest: Manifest): Promise<{ status: PolicyStatus; reasons: string[]; warnings: string[] }> {
  const blocked = await managedBlocks();
  if (!config.policy) return { status: "not_set_up", reasons: [], warnings: blocked };
  if (!config.policy.enabled) return { status: "disabled", reasons: [], warnings: blocked };
  if (blocked.length) return { status: "blocked", reasons: blocked, warnings: [] };
  if (!manifest.policy) return { status: "drift", reasons: ["policy is on in config.json but was never written to settings"], warnings: [] };
  const checks = await checkPolicy(config, manifest.policy, { managed: [] });
  const reasons = checks.filter((c) => c.ok === false).map((c) => c.label);
  const warnings = checks.filter((c) => c.ok === "warn").map((c) => c.label);
  return { status: reasons.length ? "drift" : "enforced", reasons, warnings };
}

const since30d = () => parseSince(`${POLICY_AUDIT_DAYS}d`);

/** Full GET /api/policy body from fresh config and manifest; audit counts are whatever the dashboard sync loop last ingested (no ingest here: it would share a connection with sync's open transaction). */
export async function policyResponse(db: Database): Promise<PolicyResponse> {
  const [config, manifest] = await Promise.all([loadConfig(), loadManifest()]);
  const rec = manifest.policy;
  const hook = (rec?.hook?.group as HookGroup | undefined)?.hooks?.[0];
  return {
    ...(await status(config, manifest)),
    config: config.policy ? { ...config.policy, escalate: config.policy.escalate === true } : null,
    rows: effectivePolicy(config),
    settings_path: rec?.settingsPath ?? null,
    hook_command: hook ? [hook.command, ...(hook.args ?? [])].join(" ") : null,
    installed_scopes: [...new Set(Object.values(manifest.installs).map((i) => i.scope))],
    audit_summary: auditSummary(db, since30d()),
    etag: await currentEtag(config, manifest),
  };
}

function size(url: URL): number {
  const raw = url.searchParams.get("size");
  if (raw === null) return AUDIT_DEFAULT_SIZE;
  if (!/^\d+$/.test(raw) || +raw < 1 || +raw > AUDIT_MAX_SIZE) throw bad(`invalid size "${raw}": use an integer from 1 to ${AUDIT_MAX_SIZE}`);
  return +raw;
}

function audit(db: Database, url: URL): AuditResponse {
  const page = url.searchParams.get("page") ?? "1";
  if (!/^\d+$/.test(page) || +page < 1) throw bad(`invalid page "${page}": use an integer from 1`);
  const q = url.searchParams.get("q")?.trim() || undefined;
  if (q && q.length > MAX_QUERY_CHARS) throw bad(`invalid q: use at most ${MAX_QUERY_CHARS} characters`);
  let since: string;
  try {
    since = parseSince(url.searchParams.get("since") ?? `${POLICY_AUDIT_DAYS}d`);
  } catch (err) {
    throw bad(reason(err).replace("--since", "since"));
  }
  const filter = { q, since, roles: listParam(url, "role"), decisions: listParam(url, "decision"), tools: listParam(url, "tool"), caps: listParam(url, "cap") };
  const pq = { page: +page, pageSize: size(url) };
  const { items, total, facets } = auditPage(db, filter, pq);
  return { items: items.map(({ agent_id: _a, ...row }) => row), total, page: pq.page, size: pq.pageSize, facets };
}

/** GET /api/policy and /api/policy/audit; works in read-only mode. */
export async function routePolicyRead(db: Database, url: URL): Promise<Response> {
  const path = trim(url.pathname);
  try {
    if (path === "/api/policy") return Response.json(await policyResponse(db));
    if (path === "/api/policy/audit") return Response.json(audit(db, url));
    return fail(STATUS.notFound, `unknown endpoint ${path}`);
  } catch (err) {
    return errorResponse(err, `GET ${path}`);
  }
}
