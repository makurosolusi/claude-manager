import { expect, test } from "bun:test";
import { cellsTitle, rowForAgent } from "../src/web/lib/policy.use.ts";
import type { PolicyRow } from "../src/server/policy.types.ts";

const cells = (d: "allow" | "ask") => Object.fromEntries(["read", "edit", "test", "shell", "web", "agents", "git", "push", "mcp"].map((c) => [c, { decision: d, source: "preset" }])) as PolicyRow["cells"];
const rows: PolicyRow[] = [
  { row: "coder", kind: "preset", cells: { ...cells("allow"), edit: { decision: "ask", source: "override" } } },
  { row: "unknown", kind: "unknown", cells: cells("ask") },
];

test("rowForAgent: named row, unknown for externals and unlisted roles", () => {
  expect(rowForAgent(rows, { name: "coder", kind: "preset" })?.row).toBe("coder");
  expect(rowForAgent(rows, { name: "coder", kind: "external" })?.kind).toBe("unknown");
  expect(rowForAgent(rows, { name: "ghost", kind: "custom" })?.kind).toBe("unknown");
  expect(rowForAgent(rows, { name: "unknown", kind: "custom" })?.kind).toBe("unknown");
  expect(rowForAgent(undefined, { name: "coder", kind: "preset" })).toBeUndefined();
});

test("cellsTitle lists all 9 cells and marks overrides", () => {
  const t = cellsTitle(rows[0]!);
  expect(t.split(", ")).toHaveLength(9);
  expect(t).toContain("edit: ask (edited)");
  expect(t).toContain("read: allow,");
});
