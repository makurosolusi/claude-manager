import { describe, expect, test } from "bun:test";
import { getJson, isNotFound } from "../src/web/lib/api.client.ts";
import { ApiWriteError } from "../src/web/lib/api.write.ts";
import { appliedText, holdNotice, nextFrozen, takeNotice, toFailure, writeStatusOf } from "../src/web/lib/agent.write.ts";

describe("agent write helpers", () => {
  test("held notice is taken once, by the route it was addressed to", () => {
    holdNotice({ tone: "info", text: "x" }, "/agents/a");
    expect(takeNotice("/agents/a")).toEqual({ tone: "info", text: "x" });
    expect(takeNotice("/agents/a")).toBeNull();
  });
  test("a notice for ui-ux never reaches coder, and a miss clears it for good", () => {
    holdNotice({ tone: "success", text: "Saved ui-ux" }, "/agents/ui-ux");
    expect(takeNotice("/agents/coder")).toBeNull();
    expect(takeNotice("/agents/ui-ux")).toBeNull();
  });
  test("400 naming a field maps to it, otherwise banner", () => {
    expect(toFailure(new ApiWriteError("POST", "/api/agents", 400, "description is required")).field).toBe("description");
    expect(toFailure(new ApiWriteError("POST", "/api/agents", 400, "something odd")).field).toBeNull();
  });
  test("412 asks for reload, 409 keeps the server message", () => {
    expect(toFailure(new ApiWriteError("PATCH", "/p", 412, "etag mismatch")).reload).toBe(true);
    const c = toFailure(new ApiWriteError("PATCH", "/p", 409, "edited by hand; run claude-manager install --force"));
    expect(c).toEqual({ field: null, text: "edited by hand; run claude-manager install --force", reload: false });
  });
  test("plural", () => {
    expect(appliedText("Saved", "a", 1)).toBe("Saved a · applied to 1 install.");
    expect(appliedText("Saved", "a", 2)).toBe("Saved a · applied to 2 installs.");
  });
  test("a failed session check is `error`, not `read-only`", () => {
    expect(writeStatusOf(null)).toBe("loading");
    expect(writeStatusOf({ write: true })).toBe("write");
    expect(writeStatusOf({ write: false })).toBe("read-only");
    expect(writeStatusOf(new Error("GET /api/session failed: network error"))).toBe("error");
  });
  test("nextFrozen keeps the first snapshot while editing and drops it afterwards", () => {
    const a = { etag: "v1" }, b = { etag: "v2" };
    expect(nextFrozen(null, true, undefined)).toBeNull();
    expect(nextFrozen(null, true, a)).toBe(a);
    expect(nextFrozen(a, true, b)).toBe(a); // a background refetch must not move the etag
    expect(nextFrozen(a, false, b)).toBeNull();
  });
  test("getJson 404 carries status and keeps the message format", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "nope" }), { status: 404 })) as unknown as typeof fetch;
    try {
      const err = await getJson("/api/x").catch((e: unknown) => e);
      expect(isNotFound(err)).toBe(true);
      expect((err as Error).message).toBe("GET /api/x failed (404): nope");
      expect(isNotFound(new Error("GET /x failed (404): y"))).toBe(false);
    } finally { globalThis.fetch = orig; }
  });
});
