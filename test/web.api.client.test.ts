import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { identityOf, isLoading, keepRef, useApi, viewOf, visibleFor, withQuery } from "../src/web/lib/api.client.ts";

test("withQuery repeats array keys and keeps single values", () => {
  expect(withQuery("/api/x", { page: 2, agent: ["main", "coder"], stop: ["none"] })).toBe("/api/x?page=2&agent=main&agent=coder&stop=none");
});

test("withQuery skips undefined, empty strings and empty arrays", () => {
  expect(withQuery("/api/x", { q: "", a: undefined, b: [] })).toBe("/api/x");
  expect(withQuery("/api/x")).toBe("/api/x");
});

test("withQuery encodes values", () => {
  expect(withQuery("/api/x", { q: "a b&c", f: ["x/y"] })).toBe("/api/x?q=a+b%26c&f=x%2Fy");
});

test("useApi with a null path starts idle (no fetch), a real path starts loading", () => {
  const Probe = ({ path }: { path: string | null }) => createElement("i", null, String(useApi(path).loading));
  expect(renderToString(createElement(Probe, { path: null }))).toContain("false");
  expect(renderToString(createElement(Probe, { path: "/api/x" }))).toContain("true");
});

test("visibleFor keeps data of the same resource (tick refresh) and drops data of another path or query", () => {
  const state = { key: "/api/sessions/a", data: 1 };
  expect(visibleFor(state, "/api/sessions/a")).toBe(state);
  expect(visibleFor(state, "/api/sessions/bad-id")).toBeUndefined();
  expect(visibleFor(state, "/api/sessions/a?page=2")).toBeUndefined();
});

test("identityOf ignores the sliding since bound but keeps every other param", () => {
  expect(identityOf("/api/x?since=2026-01-01T00%3A00%3A00.000Z&page=1")).toBe("/api/x?page=1");
  expect(identityOf("/api/x?since=a")).toBe("/api/x");
  expect(identityOf("/api/x")).toBe("/api/x");
  expect(identityOf("/api/x?since=a&q=z")).not.toBe(identityOf("/api/x?since=a&q=y"));
  expect(identityOf("/api/x?since=a&page=1")).toBe(identityOf("/api/x?since=b&page=1"));
});

test("isLoading: skeleton on first load or new resource, never on a refresh that holds data or an error", () => {
  expect(isLoading(undefined, true)).toBe(true);
  expect(isLoading({ data: undefined, error: undefined }, true)).toBe(true);
  expect(isLoading({ data: [1], error: undefined }, true)).toBe(false);
  expect(isLoading({ data: undefined, error: new Error("x") }, true)).toBe(false);
  expect(isLoading(undefined, false)).toBe(false);
});

test("keepRef keeps the old reference for identical JSON and swaps it for changed data or Errors", () => {
  const prev = { a: [1, 2] };
  expect(keepRef(prev, { a: [1, 2] })).toBe(prev);
  const next = { a: [1, 3] };
  expect(keepRef(prev, next)).toBe(next);
  expect(keepRef(undefined, next)).toBe(next);
  const e2 = new Error("b");
  expect(keepRef<unknown>(new Error("a"), e2)).toBe(e2);
});

test("identityOf: same range with a recomputed since is one resource, another range is a new one", () => {
  const a = withQuery("/api/x", { since: "2026-01-02T00:00:00.000Z", range: "30d", page: 1 });
  const b = withQuery("/api/x", { since: "2026-01-02T00:05:00.000Z", range: "30d", page: 1 });
  const c = withQuery("/api/x", { since: "2025-12-26T00:00:00.000Z", range: "7d", page: 1 });
  expect(identityOf(a)).toBe(identityOf(b));
  expect(identityOf(a)).not.toBe(identityOf(c));
  expect(identityOf(a)).toContain("range=30d");
  expect(identityOf(a)).not.toContain("since");
});

test("viewOf: refresh of the same resource is not stale, a new query on the same endpoint dims old data, another endpoint drops it", () => {
  const state = { key: "/api/x?range=30d", path: "/api/x", data: [1], error: undefined };
  expect(viewOf(state, "/api/x?range=30d", "/api/x")).toEqual({ cur: state, stale: false });
  expect(viewOf(state, "/api/x?range=7d", "/api/x")).toEqual({ cur: state, stale: true });
  expect(viewOf(state, "/api/y", "/api/y")).toEqual({ cur: undefined, stale: false });
  const failed = { ...state, data: undefined, error: new Error("x") };
  expect(viewOf(failed, "/api/x?range=7d", "/api/x")).toEqual({ cur: undefined, stale: false });
});

test("a stale view is not a skeleton: isLoading is false while old data is held", () => {
  const state = { key: "/api/x?range=30d", path: "/api/x", data: [1], error: undefined };
  const { cur } = viewOf(state, "/api/x?range=7d", "/api/x");
  expect(isLoading(cur, true)).toBe(false);
});
