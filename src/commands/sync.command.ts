import { openDb } from "../db/db.schema.ts";
import { pricingPath } from "../ingest/pricing.service.ts";
import { sync, type SyncResult } from "../ingest/ingest.service.ts";
import type { Command } from "./command.types.ts";

export function formatSync(r: SyncResult): string {
  const lines = [
    `scanned ${r.files} transcripts (${r.changed} changed), +${r.newRequests} requests, ${r.recomputed} re-priced in ${(r.ms / 1000).toFixed(1)}s`,
  ];
  if (r.badLines) lines.push(`warning: ${r.badLines} unparseable lines skipped`);
  if (r.unpriced.length) lines.push(`warning: no rates for ${r.unpriced.join(", ")} (cost shown as 0); add them to ${pricingPath()}`);
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  return lines.join("\n");
}

export const syncCommand: Command = {
  name: "sync",
  summary: "Import Claude Code transcripts into the local analytics DB",
  usage: `Usage: claude-manager sync

Reads ~/.claude/projects/**/*.jsonl incrementally (only new bytes) into
~/.claude-manager/data.db. Costs are recomputed when pricing changes.
Prompt text is stored locally unless config "storePromptText" is false.`,
  async run() {
    const db = openDb();
    try {
      console.log(formatSync(await sync(db)));
    } finally {
      db.close();
    }
    return 0;
  },
};
