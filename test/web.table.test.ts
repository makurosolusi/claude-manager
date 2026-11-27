import { expect, test } from "bun:test";
import { pageWindow } from "../src/web/components/table.pagination.tsx";
import { nextSort, visibleColumns, type Column } from "../src/web/components/data.table.tsx";
import { hashHref, parseHash, withParams } from "../src/web/lib/hash.route.ts";
import { DEFAULT_PAGE_SIZE, parseTableQuery, patchTable, tableParams, type TableSpec, type TableState } from "../src/web/lib/table.query.ts";

const spec: TableSpec = {
  sorts: ["last", "cost", "reqs"],
  defaultSort: "last",
  defaultDir: "desc",
  groups: ["none", "project", "family"],
  facets: { family: ["opus", "sonnet", "haiku"], project: "free" },
};
const parse = (qs: string) => parseTableQuery(new URLSearchParams(qs), spec);
const defaults: TableState = { q: "", sort: "last", dir: "desc", page: 1, size: DEFAULT_PAGE_SIZE, group: "none", filters: { family: [], project: [] } };

test("pageWindow edges", () => {
  expect(pageWindow(1, 1)).toEqual([1]);
  expect(pageWindow(1, 2)).toEqual([1, 2]);
  expect(pageWindow(2, 2)).toEqual([1, 2]);
  expect(pageWindow(1, 12)).toEqual([1, 2, "gap", 12]);
  expect(pageWindow(5, 12)).toEqual([1, "gap", 4, 5, 6, "gap", 12]);
  expect(pageWindow(12, 12)).toEqual([1, "gap", 11, 12]);
  expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]); // no gap when nothing is skipped
});

test("empty params parse to defaults", () => {
  expect(parse("")).toEqual(defaults);
});

test("unknown values are dropped", () => {
  expect(parse("sort=bogus&dir=up&page=0&size=7&group=nope&family=gpt")).toEqual(defaults);
  expect(parse("page=2.5").page).toBe(1);
  expect(parse("page=abc").page).toBe(1);
});

test("repeated facet keys are read, deduped and validated", () => {
  const s = parse("family=opus&family=haiku&family=opus&family=x&project=/w/a&project=/w/b");
  expect(s.filters).toEqual({ family: ["opus", "haiku"], project: ["/w/a", "/w/b"] });
});

test("round trip keeps non-defaults and drops defaults", () => {
  const s = parse("q=%20cors%20&sort=cost&dir=asc&page=3&size=100&group=project&family=opus&family=haiku");
  expect(s).toMatchObject({ q: "cors", sort: "cost", dir: "asc", page: 3, size: 100, group: "project" });
  expect(tableParams(s, spec)).toEqual({ q: "cors", sort: "cost", dir: "asc", page: "3", size: "100", group: "project", family: ["opus", "haiku"], project: undefined });
  const all = tableParams(parse(""), spec);
  expect(Object.values(all).every((v) => v === undefined)).toBe(true);
  expect(parseTableQuery(new URLSearchParams(hashHref("/x", tableParams(s, spec)).split("?")[1]), spec)).toEqual(s);
});

test("any change except page resets to page 1", () => {
  const s = parse("page=4");
  expect(patchTable(s, { q: "x" }).page).toBe(1);
  expect(patchTable(s, { size: 25 }).page).toBe(1);
  expect(patchTable(s, { filters: { family: ["opus"], project: [] } }).page).toBe(1);
  expect(patchTable(s, { page: 5 }).page).toBe(5);
});

test("hashHref and withParams write string[] as repeated keys", () => {
  expect(hashHref("/s", { family: ["opus", "haiku"], q: "a", empty: undefined, none: [] })).toBe("#/s?family=opus&family=haiku&q=a");
  const route = parseHash("#/s?family=opus&q=a");
  expect(withParams(route, { family: ["sonnet", "haiku"] })).toBe("#/s?q=a&family=sonnet&family=haiku");
  expect(withParams(route, { family: [], q: undefined })).toBe("#/s");
  expect(withParams(route, { q: "b" })).toBe("#/s?family=opus&q=b"); // string behaviour unchanged
});

test("visibleColumns keeps the first and non-hideable columns", () => {
  const col = (id: string, hideable?: boolean): Column<number> => ({ id, header: id, cell: () => null, hideable });
  const cols = [col("a"), col("b"), col("c", false), col("d")];
  expect(visibleColumns(cols, ["a", "b", "c", "d"]).map((c) => c.id)).toEqual(["a", "c"]);
  expect(visibleColumns(cols).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
});

test("nextSort starts descending and toggles", () => {
  expect(nextSort(undefined, "cost")).toEqual({ key: "cost", dir: "desc" });
  expect(nextSort({ key: "cost", dir: "desc" }, "cost")).toEqual({ key: "cost", dir: "asc" });
});
