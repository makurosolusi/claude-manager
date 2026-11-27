import { parseArgs } from "node:util";
import { CliError } from "../cli.error.ts";
import { openDb } from "../db/db.schema.ts";
import { GROUP_BY, usageBy, usageTotal, type GroupBy, type UsageRow } from "../db/stats.repository.ts";
import { sync } from "../ingest/ingest.service.ts";
import type { Command } from "./command.types.ts";

const DEFAULT_SINCE = "30d";
const DEFAULT_LIMIT = "20";
const UNIT_MS: Record<string, number> = { h: 3_600_000, d: 86_400_000 };

/** "7d" / "24h" relative to now, or any date Date.parse accepts. */
export function parseSince(value: string, now = Date.now()): string {
  const rel = /^(\d+)([hd])$/.exec(value);
  const ms = rel ? now - Number(rel[1]) * UNIT_MS[rel[2]!]! : Date.parse(value);
  if (Number.isNaN(ms)) throw new CliError(`invalid --since "${value}": use e.g. 7d, 24h or 2026-11-01`);
  return new Date(ms).toISOString();
}

const tok = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const usd = (n: number) => `$${n.toFixed(2)}`;

function table(rows: (Omit<UsageRow, "key"> & { key: string })[]): string {
  const head = ["", "requests", "input", "cache write", "cache read", "output", "cost"];
  const body = rows.map((r) => [
    r.key + (r.unpriced ? ` (${r.unpriced} unpriced)` : ""),
    String(r.requests),
    tok(r.input),
    tok(r.cache_write),
    tok(r.cache_read),
    tok(r.output),
    usd(r.cost_usd),
  ]);
  const all = [head, ...body];
  const widths = head.map((_, i) => Math.max(...all.map((row) => row[i]!.length)));
  return all.map((row) => row.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ")).join("\n");
}

export const statsCommand: Command = {
  name: "stats",
  summary: "Token usage and estimated cost by model, role, project or day",
  usage: `Usage: claude-manager stats [options]

Syncs new transcript lines first, then prints totals. Costs are estimates
from list prices (Claude Code's local price cache, overridable in
~/.claude-manager/pricing.json); subscription plans are not billed this way.
Priced by the model that served each request. Background calls Claude Code
does not write to transcripts (e.g. title generation) are not included.

Options:
  --by <${GROUP_BY.join("|")}>  Group rows (default: model)
  --since <7d|24h|date>          Only requests since then (default: ${DEFAULT_SINCE})
  --project <text>               Only projects whose path contains <text>
  --limit <n>                    Max rows (default: ${DEFAULT_LIMIT})
  --json                         Machine-readable output`,
  async run(args) {
    const { values } = parseArgs({
      args,
      options: {
        by: { type: "string", default: "model" },
        since: { type: "string", default: DEFAULT_SINCE },
        project: { type: "string" },
        limit: { type: "string", default: DEFAULT_LIMIT },
        json: { type: "boolean", default: false },
      },
    });
    const by = values.by as GroupBy;
    if (!GROUP_BY.includes(by)) throw new CliError(`invalid --by "${values.by}": use ${GROUP_BY.join(", ")}`);
    const limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) throw new CliError(`invalid --limit "${values.limit}"`);
    const filter = { since: parseSince(values.since!), project: values.project };

    const db = openDb();
    try {
      await sync(db);
      const rows = usageBy(db, by, filter, limit);
      const total = usageTotal(db, filter);
      if (values.json) {
        console.log(JSON.stringify({ by, ...filter, rows, total }, null, 2));
        return 0;
      }
      if (!total.requests) {
        console.log(`no requests since ${filter.since}`);
        return 0;
      }
      console.log(table([...rows, { key: "total", ...total }]));
    } finally {
      db.close();
    }
    return 0;
  },
};
