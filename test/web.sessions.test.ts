import { expect, test } from "bun:test";
import { parseHash } from "../src/web/lib/hash.route.ts";
import { SEARCH_MAX_CHARS, parseSessionsQuery, sessionsHref, type SessionsState } from "../src/web/lib/sessions.query.ts";

const parse = (qs: string) => parseSessionsQuery(new URLSearchParams(qs));
const defaults: SessionsState = { q: "", sort: "last", dir: "desc", project: "", page: 1 };

test("empty params parse to defaults", () => {
  expect(parse("")).toEqual(defaults);
});

test("valid params are read; q is trimmed", () => {
  expect(parse("q=%20cors%20&sort=cost&dir=asc&project=/w/acme/web&page=3")).toEqual({ q: "cors", sort: "cost", dir: "asc", project: "/w/acme/web", page: 3 });
});

test("invalid sort, dir and page fall back to defaults", () => {
  expect(parse("sort=bogus&dir=up&page=0")).toEqual(defaults);
  expect(parse("page=2.5").page).toBe(1);
  expect(parse("page=abc").page).toBe(1);
});

test("q is clipped to the server limit", () => {
  expect(parse(`q=${"a".repeat(SEARCH_MAX_CHARS + 50)}`).q).toHaveLength(SEARCH_MAX_CHARS);
});

test("defaults and the default range are dropped from the href", () => {
  expect(sessionsHref({ ...defaults, sort: "last", dir: "desc" }, "30d")).toBe("#/sessions");
});

test("non-default range and state are kept and round-trip", () => {
  const state = { q: "api", sort: "cost", dir: "asc", project: "acme/web", page: 2 } as const;
  const href = sessionsHref(state, "7d");
  const { path, params } = parseHash(href);
  expect(path).toBe("/sessions");
  expect(params.get("range")).toBe("7d");
  expect(parseSessionsQuery(params)).toEqual(state);
});

test("blank search is not written", () => {
  expect(sessionsHref({ ...defaults, sort: "tokens", dir: "desc", q: "   " }, "all")).toBe("#/sessions?range=all&sort=tokens");
});
