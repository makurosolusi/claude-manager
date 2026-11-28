import type { Database } from "bun:sqlite";
import { buildAgentDetail, buildAgents } from "../agents/agents.catalog.ts";
import { checkRouting, type RoutingCheck } from "../commands/doctor.routing.ts";
import { loadConfigSync } from "../config/config.store.ts";
import { agentUsage } from "../db/agents.repository.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { resolveRoles } from "../roles/roles.registry.ts";
import { HTTP } from "./filter.params.ts";

/** Usage window of the Agents page, in days. */
export const AGENT_USAGE_DAYS = 30;
const DAY_MS = 86_400_000;
/** ISO start of the Agents usage window ending at `now`; shared by the read and write routes. */
export const agentUsageSince = (now = Date.now()) => new Date(now - AGENT_USAGE_DAYS * DAY_MS).toISOString();
const AGENT_PATH = /^\/api\/agents(?:\/([^/]+))?$/;

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** Routing checks that are not ok, split into global labels and per-role labels. */
async function routingWarnings(config: ReturnType<typeof loadConfigSync>): Promise<RoutingCheck[]> {
  const manifest = await loadManifest();
  const checks = await checkRouting(Object.values(manifest.installs), resolveRoles(config).map((r) => r.name));
  return checks.filter((c) => c.ok !== true);
}

async function respond(db: Database, name: string | undefined, now: number): Promise<Response> {
  const config = loadConfigSync(); // fresh per request, like liveMeta, so CLI changes show after a reload
  const usage = agentUsage(db, agentUsageSince(now));
  const opts = { cwd: process.cwd() };
  const bad = await routingWarnings(config);
  if (name === undefined) {
    const list = await buildAgents(config, usage, opts);
    return Response.json({ ...list, warnings: [...list.warnings, ...bad.filter((c) => !c.role).map((c) => c.label)] });
  }
  const detail = await buildAgentDetail(config, name, usage, opts);
  if (!detail) return fail(HTTP.notFound, `agent "${name}" not found`);
  return Response.json({ ...detail, warnings: [...detail.warnings, ...bad.filter((c) => c.role === name).map((c) => c.label)] });
}

/** True for /api/agents and /api/agents/:name. */
export const isAgentsPath = (pathname: string) => AGENT_PATH.test(pathname.replace(/\/+$/, ""));

/** Serves GET /api/agents and /api/agents/:name; undefined for other paths. Errors are returned as JSON with context. */
export function routeAgents(db: Database, pathname: string, now = Date.now()): Promise<Response> | undefined {
  const m = AGENT_PATH.exec(pathname.replace(/\/+$/, ""));
  if (!m) return undefined;
  let name: string | undefined;
  try {
    name = m[1] === undefined ? undefined : decodeURIComponent(m[1]);
  } catch {
    return Promise.resolve(fail(HTTP.badRequest, "invalid agent name encoding"));
  }
  return respond(db, name, now).catch((err: unknown) =>
    fail(500, `load agents${name ? ` "${name}"` : ""}: ${err instanceof Error ? err.message : String(err)}`),
  );
}
