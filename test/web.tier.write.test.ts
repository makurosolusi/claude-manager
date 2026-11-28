import { afterEach, describe, expect, test } from "bun:test";
import { ApiWriteError, resetSession } from "../src/web/lib/api.write.ts";
import { saveTier, tierFailure, tierSavedText } from "../src/web/lib/tier.write.ts";

const orig = globalThis.fetch;
afterEach(() => { globalThis.fetch = orig; resetSession(); });

interface Call { url: string; init: RequestInit }
function mockFetch(reply: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return reply(url); }) as unknown as typeof fetch;
  return calls;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("saveTier", () => {
  test("sends PUT with If-Match, the session token and the model body", async () => {
    const calls = mockFetch((u) => (u === "/api/session" ? json({ write: true, token: "tok" }) : json({ tier: "work", model: "claude-sonnet-5-6", previous: "claude-sonnet-5-5", applied: 2, etag: "e2" })));
    const r = await saveTier("work", "claude-sonnet-5-6", "e1");
    expect(r.applied).toBe(2);
    const put = calls.find((c) => c.url === "/api/tiers/work")!;
    expect(put.init.method).toBe("PUT");
    const h = put.init.headers as Record<string, string>;
    expect(h["If-Match"]).toBe("e1");
    expect(h["X-CM-Token"]).toBe("tok");
    expect(put.init.body).toBe(JSON.stringify({ model: "claude-sonnet-5-6" }));
  });
  test("a 412 throws ApiWriteError that asks for Reload", async () => {
    mockFetch((u) => (u === "/api/session" ? json({ write: true, token: "t" }) : json({ error: "etag mismatch" }, 412)));
    const err = await saveTier("work", "claude-sonnet-5-6", "old").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiWriteError);
    expect(tierFailure(err).reload).toBe(true);
  });
});

describe("tier messages", () => {
  test("saved text and the 0-install suffix", () => {
    expect(tierSavedText({ tier: "work", model: "claude-sonnet-5-6", applied: 2 })).toBe("work → claude-sonnet-5-6 · applied to 2 installs.");
    expect(tierSavedText({ tier: "work", model: "claude-sonnet-5-6", applied: 1 })).toBe("work → claude-sonnet-5-6 · applied to 1 install.");
    expect(tierSavedText({ tier: "basic", model: "claude-haiku-4-5", applied: 0 })).toBe("basic → claude-haiku-4-5 · applied to 0 installs. Written on claude-manager install.");
  });
  test("400 and 409 show the server message without Reload", () => {
    const m = 'model must be a full model ID, not the alias "sonnet"';
    expect(tierFailure(new ApiWriteError("PUT", "/api/tiers/work", 400, m))).toEqual({ field: null, text: m, reload: false });
    expect(tierFailure(new ApiWriteError("PUT", "/api/tiers/work", 409, "edited by hand")).reload).toBe(false);
    expect(tierFailure(new Error("network")).text).toBe("network");
  });
});
