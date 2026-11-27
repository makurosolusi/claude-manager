import type { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { loadConfig } from "../config/config.store.ts";
import { openDb } from "../db/db.schema.ts";
import { sync } from "../ingest/ingest.service.ts";
import { DEFAULT_DASHBOARD_PORT, handleApi } from "../server/dashboard.api.ts";
import index from "../web/index.html";
import type { Command } from "./command.types.ts";
import { formatSync } from "./sync.command.ts";

/** How often the running dashboard re-imports new transcript bytes. */
export const SYNC_INTERVAL_MS = 5000;
const HOSTNAME = "127.0.0.1";
const MAX_PORT = 65535;

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > MAX_PORT) throw new CliError(`invalid --port "${raw}": use 1-${MAX_PORT}`);
  return n;
}

function serve(db: Database, port: number) {
  try {
    return Bun.serve({
      hostname: HOSTNAME,
      port,
      routes: { "/": index },
      fetch: (req) => handleApi(req, db, port) ?? new Response("Not Found", { status: 404 }),
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") throw new CliError(`port ${port} is in use; try --port <n>`);
    throw new Error(`start dashboard on ${HOSTNAME}:${port}: ${(err as Error).message}`, { cause: err });
  }
}

function startSyncLoop(db: Database) {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sync(db);
    } catch (err) {
      // Keep serving the last good data; the next tick retries.
      console.error(`dashboard: background sync failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  }, SYNC_INTERVAL_MS);
}

export const dashboardCommand: Command = {
  name: "dashboard",
  summary: "Open a local web dashboard of usage and estimated cost",
  usage: `Usage: claude-manager dashboard [--port <n>]

Syncs transcripts, then serves a read-only dashboard at http://${HOSTNAME}:<port>
(default port ${DEFAULT_DASHBOARD_PORT}, or config "dashboardPort"). New transcript data is
picked up every ${SYNC_INTERVAL_MS / 1000}s. Costs are estimates at API list prices, not your bill.
Stop with Ctrl+C.

Options:
  --port <n>   Port to listen on (127.0.0.1 only)`,
  async run(args) {
    const { values } = parseArgs({ args, options: { port: { type: "string" } } });
    const port = values.port ? parsePort(values.port) : ((await loadConfig()).dashboardPort ?? DEFAULT_DASHBOARD_PORT);

    const db = openDb();
    const server = await sync(db)
      .then((r) => {
        console.log(formatSync(r));
        return serve(db, port);
      })
      .catch((err) => {
        db.close();
        throw err;
      });
    const timer = startSyncLoop(db);
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
