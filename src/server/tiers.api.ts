import type { Database } from "bun:sqlite";
import { CliError, type ErrorReason } from "../cli.error.ts";
import { applyConfig, StaleConfigError } from "../config/config.apply.ts";
import { isTier, loadConfig, TIERS, type Tier } from "../config/config.store.ts";
import { loadPricing } from "../ingest/pricing.service.ts";
import { setTierModel } from "../roles/roles.service.ts";
import { buildTiers } from "../tiers/tiers.catalog.ts";
import type { TierWriteResult } from "./tiers.types.ts";
import { checkWrite, type WriteSession } from "./write.guard.ts";

const STATUS = { ok: 200, badRequest: 400, notFound: 404, conflict: 409, stale: 412, noEtag: 428, internal: 500 } as const;
const REASON_STATUS: Record<ErrorReason, number> = { invalid: STATUS.badRequest, not_found: STATUS.notFound, conflict: STATUS.conflict, server: STATUS.internal };
const COLLECTION_PATH = /^\/api\/tiers$/;
const ITEM_PATH = /^\/api\/tiers\/([^/]+)$/;
const BODY_ERROR = 'body must be {"model": "<model-id>"}';

const fail = (status: number, error: string) => Response.json({ error }, { status });
const trim = (pathname: string) => pathname.replace(/\/+$/, "");
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** True for /api/tiers and /api/tiers/:tier. */
export const isTiersPath = (pathname: string) => COLLECTION_PATH.test(trim(pathname)) || ITEM_PATH.test(trim(pathname));

/** True when method + path is the tiers write route: PUT /api/tiers/:tier. */
export const isTiersWriteRoute = (method: string, pathname: string) => method === "PUT" && ITEM_PATH.test(trim(pathname));

/** GET /api/tiers: fresh config, pricing and 30-day usage; works in read-only mode. */
export async function routeTiersRead(db: Database, pathname: string, now = new Date()): Promise<Response> {
  if (!COLLECTION_PATH.test(trim(pathname))) return fail(STATUS.notFound, `unknown endpoint ${trim(pathname)}`);
  try {
    const [config, pricing] = await Promise.all([loadConfig(), loadPricing()]);
    return Response.json(buildTiers(config, db, pricing, now));
  } catch (err) {
    return fail(STATUS.internal, `load tiers: ${reason(err)}`);
  }
}

/** PUT /api/tiers/:tier (Host check already done): guard, If-Match, validate, then write under the config lock. */
export async function routeTiersWrite(req: Request, pathname: string, session: WriteSession, port: number): Promise<Response> {
  const checked = await checkWrite(req, { ...session, port, isWriteRoute: true });
  if (!checked.ok) return checked.res;
  const ifMatch = req.headers.get("if-match");
  if (ifMatch === null) return fail(STATUS.noEtag, "If-Match header is required");
  let tier: string;
  try {
    tier = decodeURIComponent(ITEM_PATH.exec(trim(pathname))![1]!);
  } catch (err) {
    return fail(STATUS.badRequest, `invalid tier encoding: ${reason(err)}`);
  }
  if (!isTier(tier)) return fail(STATUS.notFound, `unknown tier "${tier}": use ${TIERS.join(", ")}`);
  const body = checked.body as Record<string, unknown> | null;
  const keys = typeof body === "object" && body !== null && !Array.isArray(body) ? Object.keys(body) : [];
  if (keys.length !== 1 || keys[0] !== "model" || typeof body!.model !== "string") return fail(STATUS.badRequest, BODY_ERROR);
  const model = body!.model as string;
  let previous = "";
  try {
    const { applied, config, etag } = await applyConfig(
      (cur) => {
        previous = cur.tiers[tier as Tier];
        return setTierModel(cur, tier, model);
      },
      { expectedEtag: ifMatch, skipUnchanged: true },
    );
    const result: TierWriteResult = { tier: tier as Tier, model: config.tiers[tier as Tier], previous, applied, etag };
    return Response.json(result, { status: STATUS.ok });
  } catch (err) {
    if (err instanceof StaleConfigError) return fail(STATUS.stale, err.message);
    if (err instanceof CliError) return fail(REASON_STATUS[err.reason], err.message);
    return fail(STATUS.internal, `PUT tier "${tier}": ${reason(err)}`);
  }
}
