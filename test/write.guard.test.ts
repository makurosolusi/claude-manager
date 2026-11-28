import { describe, expect, test } from "bun:test";
import { checkWrite, createSessionToken, MAX_BODY_BYTES, type WriteOpts } from "../src/server/write.guard.ts";

const PORT = 5757; // test-only
const TOKEN = "a".repeat(64); // test-only
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OPTS: WriteOpts = { port: PORT, token: TOKEN, readOnly: false, isWriteRoute: true };

function req(init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {}): Request {
  const method = init.method ?? "POST";
  const headers = { origin: ORIGIN, "x-cm-token": TOKEN, "content-type": "application/json", ...init.headers };
  return new Request(`${ORIGIN}/api/agents`, { method, headers, body: init.body === undefined ? "{}" : init.body });
}

async function fail(r: Request, opts: WriteOpts = OPTS) {
  const out = await checkWrite(r, opts);
  if (out.ok) throw new Error("expected failure");
  return { status: out.res.status, error: ((await out.res.json()) as { error: string }).error };
}

describe("checkWrite order", () => {
  test("OPTIONS and GET are 405", async () => {
    expect((await fail(req({ method: "OPTIONS", body: null }))).status).toBe(405);
    expect((await fail(req({ method: "GET", body: null }))).status).toBe(405);
  });

  test("unknown route is 405 before read-only", async () => {
    expect((await fail(req(), { ...OPTS, isWriteRoute: false, readOnly: true })).status).toBe(405);
  });

  test("read-only is 403 even with a valid token, and beats a bad origin", async () => {
    const r = await fail(req({ headers: { origin: "http://evil.test" } }), { ...OPTS, readOnly: true });
    expect(r).toEqual({ status: 403, error: "dashboard is read-only (started with --read-only)" });
  });

  test("origin error wins over token error", async () => {
    const r = await fail(req({ headers: { origin: "http://evil.test", "x-cm-token": "nope" } }));
    expect(r).toEqual({ status: 403, error: "forbidden origin" });
  });

  test("missing origin is 403", async () => {
    const r = new Request(`${ORIGIN}/api/agents`, { method: "POST", headers: { "x-cm-token": TOKEN, "content-type": "application/json" }, body: "{}" });
    expect(await fail(r)).toEqual({ status: 403, error: "forbidden origin" });
  });

  test("origin with the wrong port is 403", async () => {
    expect((await fail(req({ headers: { origin: "http://127.0.0.1:1" } }))).status).toBe(403);
  });

  test("localhost origin is accepted", async () => {
    const out = await checkWrite(req({ headers: { origin: `http://localhost:${PORT}` } }), OPTS);
    expect(out.ok).toBe(true);
  });

  test("Sec-Fetch-Site cross-site is 403 and beats token error", async () => {
    const r = await fail(req({ headers: { "sec-fetch-site": "cross-site", "x-cm-token": "nope" } }));
    expect(r.status).toBe(403);
    expect(r.error).not.toBe("missing or invalid token");
  });

  test("Sec-Fetch-Site same-origin passes", async () => {
    expect((await checkWrite(req({ headers: { "sec-fetch-site": "same-origin" } }), OPTS)).ok).toBe(true);
  });

  test("wrong-length, wrong-value and missing tokens are 403", async () => {
    for (const token of ["short", "b".repeat(64), "a".repeat(65)]) {
      expect(await fail(req({ headers: { "x-cm-token": token } }))).toEqual({ status: 403, error: "missing or invalid token" });
    }
    const noToken = new Request(`${ORIGIN}/api/agents`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    expect((await fail(noToken)).error).toBe("missing or invalid token");
  });

  test("token error wins over content-type error", async () => {
    const r = await fail(req({ headers: { "x-cm-token": "nope", "content-type": "text/plain" } }));
    expect(r.status).toBe(403);
  });
});

describe("checkWrite body", () => {
  test("text/plain is 415", async () => {
    expect((await fail(req({ headers: { "content-type": "text/plain" } }))).status).toBe(415);
  });

  test("json with charset passes and parses", async () => {
    const out = await checkWrite(req({ headers: { "content-type": "application/json; charset=utf-8" }, body: '{"a":1}' }), OPTS);
    expect(out).toEqual({ ok: true, body: { a: 1 } });
  });

  test("PATCH with a valid body is ok", async () => {
    expect(await checkWrite(req({ method: "PATCH", body: '{"b":[2]}' }), OPTS)).toEqual({ ok: true, body: { b: [2] } });
  });

  test("Content-Length over the limit is 413", async () => {
    const r = await fail(req({ headers: { "content-length": String(MAX_BODY_BYTES + 1) } }));
    expect(r.status).toBe(413);
  });

  test("oversized body is 413 even with a body-less content-length", async () => {
    expect((await fail(req({ body: "x".repeat(MAX_BODY_BYTES + 1) }))).status).toBe(413);
  });

  test("chunked stream over the limit without Content-Length is 413", async () => {
    const chunk = new Uint8Array(16 * 1024).fill(32);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ >= 5) return c.close();
        c.enqueue(chunk);
      },
    });
    const r = new Request(`${ORIGIN}/api/agents`, {
      method: "POST",
      headers: { origin: ORIGIN, "x-cm-token": TOKEN, "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    expect(r.headers.get("content-length")).toBeNull();
    expect((await fail(r)).status).toBe(413);
  });

  test("a body at exactly the limit passes", async () => {
    const pad = " ".repeat(MAX_BODY_BYTES - 2);
    expect((await checkWrite(req({ body: `{${pad}}` }), OPTS)).ok).toBe(true);
  });

  test("invalid JSON is 400", async () => {
    expect(await fail(req({ body: "{nope" }))).toEqual({ status: 400, error: "invalid JSON body" });
  });

  test("DELETE returns ok with undefined body", async () => {
    const out = await checkWrite(req({ method: "DELETE", body: null, headers: { "content-type": "text/plain" } }), OPTS);
    expect(out).toEqual({ ok: true, body: undefined });
  });
});

describe("createSessionToken", () => {
  test("is 64 hex chars and unique per call", () => {
    const a = createSessionToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(createSessionToken()).not.toBe(a);
  });
});
