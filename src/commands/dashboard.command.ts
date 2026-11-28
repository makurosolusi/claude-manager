import type { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { loadConfig } from "../config/config.store.ts";
import { openDb } from "../db/db.schema.ts";
import { sync, type SyncResult } from "../ingest/ingest.service.ts";
import { DEFAULT_DASHBOARD_PORT, handleRequest, SYNC_INTERVAL_MS, type MetaProvider } from "../server/dashboard.api.ts";
import { liveMeta } from "../server/dashboard.meta.ts";
import type { SyncMeta } from "../server/dashboard.types.ts";
import { createSessionToken, type WriteSession } from "../server/write.guard.ts";
import index from "../web/index.html";
import type { Command } from "./command.types.ts";
import { formatSync } from "./sync.command.ts";

const HOSTNAME = "127.0.0.1";
const MAX_PORT = 65535;

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > MAX_PORT) throw new CliError(`invalid --port "${raw}": use 1-${MAX_PORT}`);
  return n;
}

function serve(db: Database, port: number, meta: MetaProvider, session: WriteSession) {
  try {
    return Bun.serve({
      hostname: HOSTNAME,
      port,
      // Bun defaults to dev mode unless NODE_ENV=production, which injects the HMR client and error overlay.
      development: false,
      // Bun 1.4.2: with development:false a second server silently shares a busy port despite the documented
      // reusePort default of false; set it explicitly so EADDRINUSE still surfaces as "port in use".
      reusePort: false,
      routes: { "/": index },
      fetch: (req) => handleRequest(req, db, port, meta, session) ?? new Response("Not Found", { status: 404 }),
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") throw new CliError(`port ${port} is in use; try --port <n>`);
    throw new Error(`start dashboard on ${HOSTNAME}:${port}: ${(err as Error).message}`, { cause: err });
  }
}

/** Records a sync outcome in `state` for /api/meta. */
export function recordSync(state: SyncMeta, r: SyncResult) {
  state.synced_at = new Date().toISOString();
  // New policy audit rows count as a change too, so the audit table and the policy-backed surfaces refetch.
  if (r.newRequests > 0 || r.changed > 0 || (r.policyAudit?.added ?? 0) > 0) state.changed_at = state.synced_at;
  state.error = null;
  state.warnings = r.warnings;
}

function startSyncLoop(db: Database, state: SyncMeta) {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      recordSync(state, await sync(db));
    } catch (err) {
      // Keep serving the last good data; the next tick retries.
      state.error = (err as Error).message;
      console.error(`dashboard: background sync failed: ${state.error}`);
    } finally {
      running = false;
    }
  }, SYNC_INTERVAL_MS);
}

export const dashboardCommand: Command = {
  name: "dashboard",
  summary: "Open a local web dashboard of usage and estimated cost",
  usage: `Usage: claude-manager dashboard [--port <n>] [--read-only]

Syncs transcripts, then serves a local dashboard at http://${HOSTNAME}:<port>
(default port ${DEFAULT_DASHBOARD_PORT}, or config "dashboardPort"). New transcript data is
picked up every ${SYNC_INTERVAL_MS / 1000}s. Costs are estimates at API list prices, not your bill.
Agents can be edited from the page; pass --read-only to disable all writes.
Stop with Ctrl+C.

Options:
  --port <n>   Port to listen on (127.0.0.1 only)
  --read-only  Disable every write (create, edit, delete, enable, disable)`,
  async run(args) {
    const { values } = parseArgs({ args, options: { port: { type: "string" }, "read-only": { type: "boolean" } } });
    const config = await loadConfig();
    const port = values.port ? parsePort(values.port) : (config.dashboardPort ?? DEFAULT_DASHBOARD_PORT);
    const state: SyncMeta = { synced_at: null, changed_at: null, error: null, warnings: [], interval_ms: SYNC_INTERVAL_MS };
    const meta = liveMeta(state);
    const readOnly = values["read-only"] ?? false;
    const session: WriteSession = { readOnly, token: readOnly ? null : createSessionToken() };

    const db = openDb();
    const server = await sync(db)
      .then((r) => {
        recordSync(state, r);
        console.log(formatSync(r));
        return serve(db, port, meta, session);
      })
      .catch((err) => {
        db.close();
        throw err;
      });
    const timer = startSyncLoop(db, state);
    console.log(`dashboard: http://${HOSTNAME}:${server.port}`);
    await new Promise<void>((resolve) =>
      process.once("SIGINT", () => {
        clearInterval(timer);
        server.stop(true);
        db.close();
        resolve();
      }),
    );
    return 0;
  },
};
