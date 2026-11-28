import { expect, test } from "bun:test";
import { isNavBlocked, navKind, proceedStep, registerNavBlocker, restoreStep } from "../src/web/lib/hash.route.ts";
import { createBlocker, shouldBlock } from "../src/web/lib/use.dirty.guard.ts";

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

test("blocker: dirty navigation is blocked and the target is handed over", () => {
  const held: string[] = [];
  const b = createBlocker(() => true, (t) => held.push(t));
  expect(b.check("#/agents/a?edit=1", "#/roles", "push")).toBe(true);
  expect(held).toEqual(["#/roles"]);
});
test("blocker: clean navigation is allowed and hands nothing over", () => {
  const held: string[] = [];
  const b = createBlocker(() => false, (t) => held.push(t));
  expect(b.check("#/agents/a", "#/roles", "push")).toBe(false);
  expect(held).toEqual([]);
});
test("blocker: discard passes exactly one navigation through", () => {
  const b = createBlocker(() => true, () => {});
  b.allowNext();
  expect(b.check("#/agents/a", "#/roles", "push")).toBe(false);
  expect(b.check("#/agents/a", "#/roles", "push")).toBe(true);
});
test("router: an unregistered blocker never blocks", () => {
  expect(isNavBlocked("#/a", "#/b")).toBe(false);
  const off = registerNavBlocker(() => true);
  expect(isNavBlocked("#/a", "#/b")).toBe(true);
  off();
  expect(isNavBlocked("#/a", "#/b")).toBe(false);
});
test("router: a stale unregister does not clear a newer blocker", () => {
  const offOld = registerNavBlocker(() => true);
  const offNew = registerNavBlocker(() => true);
  offOld();
  expect(isNavBlocked("#/a", "#/b")).toBe(true);
  offNew();
});

test("blocker: reports how the blocked navigation was reached", () => {
  const kinds: string[] = [];
  const b = createBlocker(() => true, (_t, k) => kinds.push(k));
  b.check("#/agents/a?edit=1", "#/agents", "back");
  b.check("#/agents/a?edit=1", "#/roles", "push");
  expect(kinds).toEqual(["back", "push"]);
});
test("navKind: unstamped entry is a push, lower index Back, higher Forward", () => {
  expect(navKind(undefined, 2)).toBe("push");
  expect(navKind(1, 2)).toBe("back");
  expect(navKind(3, 2)).toBe("forward");
  expect(navKind(2, 2)).toBe("push");
});
test("restoreStep undoes the move without rewriting an entry", () => {
  expect(restoreStep("back")).toBe("forward");
  expect(restoreStep("forward")).toBe("back");
  expect(restoreStep("push")).toBe("back");
});
test("proceedStep repeats a traversal and only assigns the hash for a push", () => {
  expect(proceedStep("back")).toBe("back");
  expect(proceedStep("forward")).toBe("forward");
  expect(proceedStep("push")).toBe("assign");
});
