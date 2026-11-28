import { expect, test } from "bun:test";
import { shouldBlock } from "../src/web/lib/use.dirty.guard.ts";

test("never blocks when clean", () => {
  expect(shouldBlock("#/agents/a", "#/sessions", false)).toBe(false);
});
test("blocks route change when dirty", () => {
  expect(shouldBlock("#/agents/a", "#/sessions", true)).toBe(true);
  expect(shouldBlock("#/agents/a", "#/agents/b", true)).toBe(true);
});
test("blocks query-only change on same page when dirty", () => {
  expect(shouldBlock("#/agents/a?edit=1", "#/agents/a", true)).toBe(true);
  expect(shouldBlock("#/agents?x=1", "#/agents?x=2", true)).toBe(true);
});
test("identical hash does not block", () => {
  expect(shouldBlock("#/agents/a", "#/agents/a", true)).toBe(false);
  expect(shouldBlock("", "#/", true)).toBe(false);
  expect(shouldBlock("#", "", true)).toBe(false);
});
