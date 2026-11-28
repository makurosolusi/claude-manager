import type { Database } from "bun:sqlite";
import { isAgentsPath, routeAgents } from "./agents.api.ts";
import { isAgentsWriteRoute, routeAgentsWrite } from "./agents.write.api.ts";
import { isPolicyPath, routePolicyRead } from "./policy.api.ts";
import { isPolicyWriteRoute, routePolicyWrite } from "./policy.write.api.ts";
import { isTiersPath, isTiersWriteRoute, routeTiersRead, routeTiersWrite } from "./tiers.api.ts";
import type { WriteSession } from "./write.guard.ts";

/** An async /api module: GET goes to `read`, a write method to `write` (after the Host guard in dashboard.api.ts). */
export interface ApiModule {
  matches(pathname: string): boolean;
  isWrite(method: string, pathname: string): boolean;
  read(db: Database, url: URL): Response | Promise<Response> | undefined;
  write(req: Request, db: Database, pathname: string, session: WriteSession, port: number): Promise<Response>;
}

export const API_MODULES: readonly ApiModule[] = [
  { matches: isAgentsPath, isWrite: isAgentsWriteRoute, read: (db, url) => routeAgents(db, url.pathname), write: routeAgentsWrite },
  { matches: isTiersPath, isWrite: isTiersWriteRoute, read: (db, url) => routeTiersRead(db, url.pathname), write: (req, _db, p, s, port) => routeTiersWrite(req, p, s, port) },
  { matches: isPolicyPath, isWrite: isPolicyWriteRoute, read: routePolicyRead, write: routePolicyWrite },
];

/** True when method + path is any module's write route. */
export const isWriteRoute = (method: string, pathname: string) => API_MODULES.some((m) => m.isWrite(method, pathname));
