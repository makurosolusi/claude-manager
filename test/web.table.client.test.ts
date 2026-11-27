import { afterEach, expect, test } from "bun:test";
import { groupBy, runClientTable, type ClientTableState } from "../src/web/lib/table.client.ts";
import { loadDensity, loadHiddenCols, saveDensity, saveHiddenCols } from "../src/web/lib/table.prefs.ts";

interface Row { name: string; family: string; role: string; cost: number }
const rows: Row[] = [
  { name: "alpha", family: "opus", role: "coder", cost: 3 },
  { name: "beta", family: "sonnet", role: "coder", cost: 1 },
  { name: "gamma", family: "haiku", role: "writer", cost: 2 },
  { name: "delta", family: "opus", role: "writer", cost: 5 },
];
const opts = {
  text: (r: Row) => r.name,
  facets: { family: (r: Row) => r.family, role: (r: Row) => r.role },
  sort: { cost: (r: Row) => r.cost, name: (r: Row) => r.name },
};
const base: ClientTableState = { q: "", sort: "cost", dir: "asc", page: 1, size: 50, filters: {} };
const run = (s: Partial<ClientTableState>) => runClientTable(rows, { ...base, ...s }, opts);
const names = (rs: Row[]) => rs.map((r) => r.name);

test("search is case-insensitive substring", () => {
  expect(names(run({ q: " ALP" }).filtered)).toEqual(["alpha"]);
});

test("facet is OR within one dimension and AND across", () => {
  expect(names(run({ filters: { family: ["opus", "haiku"] } }).filtered).sort()).toEqual(["alpha", "delta", "gamma"]);
  expect(names(run({ filters: { family: ["opus", "haiku"], role: ["writer"] } }).filtered).sort()).toEqual(["delta", "gamma"]);
});

test("counts exclude the facet's own selection but apply the others", () => {
  const r = run({ filters: { family: ["haiku"], role: ["coder"] } });
  expect(r.total).toBe(0);
  expect(Object.fromEntries(r.counts.family!)).toEqual({ opus: 1, sonnet: 1 });
  expect(Object.fromEntries(r.counts.role!)).toEqual({ writer: 1 });
});

test("counts respect search", () => {
  expect(Object.fromEntries(run({ q: "a" }).counts.family!)).toEqual({ opus: 2, sonnet: 1, haiku: 1 });
  expect(run({ q: "alpha" }).counts.family!.get("sonnet")).toBeUndefined();
});

test("sort asc, desc and unknown key keeps input order", () => {
  expect(names(run({ dir: "asc" }).page)).toEqual(["beta", "gamma", "alpha", "delta"]);
  expect(names(run({ dir: "desc" }).page)).toEqual(["delta", "alpha", "gamma", "beta"]);
  expect(names(run({ sort: "name", dir: "asc" }).page)).toEqual(["alpha", "beta", "delta", "gamma"]);
  expect(names(run({ sort: "nope" }).page)).toEqual(names(rows));
  expect(rows[0]!.name).toBe("alpha");
});

test("page slices after sort, total is the filtered count", () => {
  const p2 = run({ size: 3, page: 2 });
  expect(names(p2.page)).toEqual(["delta"]);
  expect(p2.total).toBe(4);
  expect(run({ size: 3, page: 9 }).page).toEqual([]);
});

test("groupBy keeps first-seen group order and row order", () => {
  const g = groupBy(rows, (r) => r.family);
  expect(g.map((x) => x.key)).toEqual(["opus", "sonnet", "haiku"]);
  expect(names(g[0]!.rows)).toEqual(["alpha", "delta"]);
});

const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (real) Object.defineProperty(globalThis, "localStorage", real);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
const setStorage = (v: unknown) => Object.defineProperty(globalThis, "localStorage", { value: v, configurable: true });

test("prefs fall back to defaults when storage throws", () => {
  const boom = () => { throw new Error("blocked"); };
  setStorage({ getItem: boom, setItem: boom });
  expect(loadHiddenCols("sessions")).toEqual([]);
  expect(loadDensity()).toBe("compact");
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(() => saveDensity("comfortable")).not.toThrow();
    expect(() => saveHiddenCols("sessions", ["tokens"])).not.toThrow();
  } finally {
    console.warn = warn;
  }
});

test("prefs round-trip and ignore junk", () => {
  const m = new Map<string, string>();
  setStorage({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  saveHiddenCols("roles", ["tokens", "cache"]);
  saveDensity("comfortable");
  expect(loadHiddenCols("roles")).toEqual(["tokens", "cache"]);
  expect(loadDensity()).toBe("comfortable");
  m.set("cm-cols:roles", "{oops");
  m.set("cm-density", "huge");
  expect(loadHiddenCols("roles")).toEqual([]);
  expect(loadDensity()).toBe("compact");
});
