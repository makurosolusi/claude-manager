import { describe, expect, test } from "bun:test";
import { ApiWriteError } from "../src/web/lib/api.write.ts";
import { appliedText, holdNotice, takeNotice, toFailure } from "../src/web/lib/agent.write.ts";

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
});
