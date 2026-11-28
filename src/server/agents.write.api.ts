import type { Database } from "bun:sqlite";
import { buildAgentDetail } from "../agents/agents.catalog.ts";
import { CliError, type ErrorReason } from "../cli.error.ts";
import { applyConfig, assertEtag, configEtag, StaleConfigError } from "../config/config.apply.ts";
import { type Config, configPath, loadConfig } from "../config/config.store.ts";
import { agentUsage } from "../db/agents.repository.ts";
import { loadManifest, type Manifest } from "../install/install.manifest.ts";
import { readText } from "../install/install.target.ts";
import { addRole, removeRole, updateRole } from "../roles/roles.service.ts";
import { AGENT_USAGE_DAYS } from "./agents.api.ts";
import type { AgentInput, AgentPatch, AgentWriteResult } from "./agents.types.ts";
import { checkWrite, type WriteSession } from "./write.guard.ts";

const STATUS = { ok: 200, created: 201, badRequest: 400, notFound: 404, conflict: 409, stale: 412, noEtag: 428, internal: 500 } as const;
const REASON_STATUS: Record<ErrorReason, number> = { invalid: STATUS.badRequest, not_found: STATUS.notFound, conflict: STATUS.conflict };
const DAY_MS = 86_400_000;
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

/** The Agent detail as the page will see it after the write. */
async function detailOf(db: Database, config: Config, name: string) {
  const usage = agentUsage(db, new Date(Date.now() - AGENT_USAGE_DAYS * DAY_MS).toISOString());
  const detail = await buildAgentDetail(config, name, usage, { cwd: process.cwd() });
  if (!detail) throw new Error(`agent "${name}" missing after write`);
  return detail;
}

/** Writes only when the config changed; a no-op patch must not touch disk or make a backup. */
async function commit(config: Config, next: Config): Promise<number> {
  if (JSON.stringify(next) === JSON.stringify(config)) return 0;
  return (await applyConfig(next)).applied;
}

type Plan = (config: Config, manifest: Manifest) => Promise<Response>;

async function plan(db: Database, req: Request, body: unknown, name: string | undefined): Promise<Plan> {
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  return async (config, manifest) => {
    if (req.method === "POST") {
      if (!isObject) return fail(STATUS.badRequest, "body must be a JSON object");
      const input = body as AgentInput;
      const applied = await commit(config, addRole(config, input));
      const agent = await detailOf(db, await loadConfig(), input.name);
      return Response.json({ agent, applied, etag: agent.etag } satisfies AgentWriteResult, { status: STATUS.created });
    }
    if (req.method === "PATCH") {
      if (!isObject) return fail(STATUS.badRequest, "body must be a JSON object");
      const applied = await commit(config, updateRole(config, name!, body as AgentPatch, manifest));
      const agent = await detailOf(db, await loadConfig(), name!);
      return Response.json({ agent, applied, etag: agent.etag } satisfies AgentWriteResult);
    }
    const applied = await commit(config, removeRole(config, name!, manifest));
    return Response.json({ removed: name, applied, etag: configEtag(await readText(configPath())) });
  };
}

/** Handles POST/PATCH/DELETE on /api/agents (Host check already done): guard, If-Match, load fresh, apply. */
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
  try {
    await assertEtag(ifMatch);
    const [config, manifest] = [await loadConfig(), await loadManifest()];
    if (name !== undefined) {
      const found = await buildAgentDetail(config, name, [], { cwd: process.cwd() });
      if (found?.kind === "external") {
        return fail(STATUS.conflict, `"${name}" is not managed by claude-manager; edit ${found.file_path ?? name} directly`);
      }
    }
    return await (await plan(db, req, checked.body, name))(config, manifest);
  } catch (err) {
    return errorResponse(err, `${req.method} agent${name ? ` "${name}"` : ""}`);
  }
}
