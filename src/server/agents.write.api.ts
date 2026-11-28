import type { Database } from "bun:sqlite";
import { buildAgentDetail, type UsageRow } from "../agents/agents.catalog.ts";
import { CliError, type ErrorReason } from "../cli.error.ts";
import { applyConfig, type ConfigBuild, StaleConfigError } from "../config/config.apply.ts";
import type { Config } from "../config/config.store.ts";
import { agentUsage } from "../db/agents.repository.ts";
import { assertRoleName } from "../roles/roles.registry.ts";
import { addRole, removeRole, updateRole } from "../roles/roles.service.ts";
import { agentUsageSince } from "./agents.api.ts";
import type { AgentInput, AgentPatch, AgentWriteResult } from "./agents.types.ts";
import { checkWrite, type WriteSession } from "./write.guard.ts";

const STATUS = { ok: 200, created: 201, badRequest: 400, notFound: 404, conflict: 409, stale: 412, noEtag: 428, internal: 500 } as const;
const REASON_STATUS: Record<ErrorReason, number> = { invalid: STATUS.badRequest, not_found: STATUS.notFound, conflict: STATUS.conflict, server: STATUS.internal };
const PATH = /^\/api\/agents(?:\/([^/]+))?$/;

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** True when method + path is an agents write route: POST /api/agents, PATCH|DELETE /api/agents/:name. */
export function isAgentsWriteRoute(method: string, pathname: string): boolean {
  const m = PATH.exec(pathname.replace(/\/+$/, ""));
  if (!m) return false;
  return m[1] === undefined ? method === "POST" : method === "PATCH" || method === "DELETE";
}

function errorResponse(err: unknown, what: string): Response {
  if (err instanceof StaleConfigError) return fail(STATUS.stale, err.message);
  if (err instanceof CliError) return fail(REASON_STATUS[err.reason], err.message);
  return fail(STATUS.internal, `${what}: ${err instanceof Error ? err.message : String(err)}`);
}

const catalogOpts = () => ({ cwd: process.cwd() });

/**
 * Path name check for PATCH/DELETE: an agent the catalog shows as external (file, built-in, plugin or usage-only) is 409;
 * any other name must be a valid role name (400) before the service looks it up.
 */
async function assertManagedName(config: Config, name: string, usage: UsageRow[]): Promise<void> {
  const found = await buildAgentDetail(config, name, usage, catalogOpts());
  if (found?.kind === "external") {
    throw new CliError(`"${name}" is not managed by claude-manager; edit ${found.file_path ?? name} directly`, 1, "conflict");
  }
  assertRoleName(name);
}

function buildFor(method: string, body: unknown, name: string | undefined, usage: UsageRow[]): ConfigBuild {
  return async (config, manifest) => {
    if (method === "POST") return addRole(config, body as AgentInput);
    await assertManagedName(config, name!, usage);
    return method === "PATCH" ? updateRole(config, name!, body as AgentPatch, manifest) : removeRole(config, name!, manifest);
  };
}

/** Handles POST/PATCH/DELETE on /api/agents (Host check already done): guard, then If-Match + transform + write under the config lock. */
export async function routeAgentsWrite(req: Request, db: Database, pathname: string, session: WriteSession, port: number): Promise<Response> {
  const checked = await checkWrite(req, { ...session, port, isWriteRoute: true });
  if (!checked.ok) return checked.res;
  const ifMatch = req.headers.get("if-match");
  if (ifMatch === null) return fail(STATUS.noEtag, "If-Match header is required");
  let name: string | undefined;
  try {
    const raw = PATH.exec(pathname.replace(/\/+$/, ""))![1];
    name = raw === undefined ? undefined : decodeURIComponent(raw);
  } catch {
    return fail(STATUS.badRequest, "invalid agent name encoding");
  }
  const body = checked.body;
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  if (req.method !== "DELETE" && !isObject) return fail(STATUS.badRequest, "body must be a JSON object");
  try {
    const usage = agentUsage(db, agentUsageSince());
    const build = buildFor(req.method, body, name, usage);
    const { applied, config, etag } = await applyConfig(build, { expectedEtag: ifMatch, skipUnchanged: true });
    if (req.method === "DELETE") return Response.json({ removed: name, applied, etag });
    const agentName = name ?? (body as AgentInput).name;
    const detail = await buildAgentDetail(config, agentName, usage, catalogOpts());
    if (!detail) throw new Error(`agent "${agentName}" missing after write`);
    const result: AgentWriteResult = { agent: { ...detail, etag }, applied, etag };
    return Response.json(result, { status: req.method === "POST" ? STATUS.created : STATUS.ok });
  } catch (err) {
    return errorResponse(err, `${req.method} agent${name ? ` "${name}"` : ""}`);
  }
}
