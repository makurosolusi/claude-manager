import { timingSafeEqual } from "node:crypto";

export const MAX_BODY_BYTES = 64 * 1024;
export const TOKEN_HEADER = "x-cm-token";
const ORIGIN_HEADER = "origin";
const FETCH_SITE_HEADER = "sec-fetch-site";
const SAME_ORIGIN = "same-origin";
const JSON_TYPE = "application/json";
const TOKEN_BYTES = 32;
/** Loopback host names the dashboard answers to (Host allowlist) and accepts as write Origin. */
export const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];
const BODY_METHODS = ["POST", "PATCH", "PUT"];
const STATUS = { badRequest: 400, forbidden: 403, notAllowed: 405, tooLarge: 413, unsupported: 415 } as const;

/** Per-process write settings; `token` is null in read-only mode. */
export type WriteSession = { token: string | null; readOnly: boolean };

export type WriteOpts = WriteSession & { port: number; isWriteRoute: boolean };
export type WriteCheck = { ok: true; body: unknown } | { ok: false; res: Response };

/** 32 random bytes as 64 hex chars; the caller must never log it. */
export function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function deny(status: number, error: string): WriteCheck {
  return { ok: false, res: Response.json({ error }, { status }) };
}

function tokenMatches(given: string | null, token: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads at most MAX_BODY_BYTES from the stream; null when the cap is exceeded. */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Spec 4.2 checks 2-8, in order. Check 1 (Host allowlist) runs earlier in dashboard.api.ts guard().
 * Nothing is read from the body until every header check has passed.
 */
export async function checkWrite(req: Request, opts: WriteOpts): Promise<WriteCheck> {
  if (!opts.isWriteRoute || !WRITE_METHODS.includes(req.method)) return deny(STATUS.notAllowed, "method not allowed");
  if (opts.readOnly || opts.token === null) return deny(STATUS.forbidden, "dashboard is read-only (started with --read-only)");
  const origin = req.headers.get(ORIGIN_HEADER);
  if (!origin || !LOCAL_HOSTS.some((h) => origin === `http://${h}:${opts.port}`)) return deny(STATUS.forbidden, "forbidden origin");
  const site = req.headers.get(FETCH_SITE_HEADER);
  if (site !== null && site !== SAME_ORIGIN) return deny(STATUS.forbidden, "forbidden origin");
  if (!tokenMatches(req.headers.get(TOKEN_HEADER), opts.token)) return deny(STATUS.forbidden, "missing or invalid token");
  if (!BODY_METHODS.includes(req.method)) return { ok: true, body: undefined };

  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== JSON_TYPE) return deny(STATUS.unsupported, `content-type must be ${JSON_TYPE}`);
  const declared = Number(req.headers.get("content-length") ?? 0);
  const tooLarge = deny(STATUS.tooLarge, `body exceeds ${MAX_BODY_BYTES} bytes`);
  if (declared > MAX_BODY_BYTES) return tooLarge;
  const bytes = await readCapped(req);
  if (!bytes) return tooLarge;
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return deny(STATUS.badRequest, "invalid JSON body");
  }
}
