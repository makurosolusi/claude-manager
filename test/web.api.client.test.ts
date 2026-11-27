import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useApi, visibleFor, withQuery } from "../src/web/lib/api.client.ts";

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
