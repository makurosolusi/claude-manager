import { CliError } from "../cli.error.ts";
import { openDb } from "../db/db.schema.ts";
import { auditPage } from "../db/policy.repository.ts";
import { ingestPolicyAudit } from "../ingest/policy.audit.ingest.ts";
import { parseSince } from "./stats.command.ts";

/** Prints the newest hook decisions (ingests the live audit file first). */
export async function auditPolicy(v: { since: string; role?: string; decision?: string; limit: string }): Promise<number> {
  const limit = Number(v.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new CliError(`invalid --limit "${v.limit}"`);
  const db = openDb();
  try {
    await ingestPolicyAudit(db);
    const filter = { since: parseSince(v.since), roles: v.role ? [v.role] : undefined, decisions: v.decision ? [v.decision] : undefined };
    const page = auditPage(db, filter, { page: 1, pageSize: limit });
    if (!page.items.length) return console.log(`no policy decisions since ${filter.since}`), 0;
    for (const r of page.items) console.log(`${r.ts}  ${r.role.padEnd(12)}  ${r.decision.padEnd(5)}  ${r.tool.padEnd(10)}  ${(r.cap ?? "-").padEnd(7)}  ${r.rule}`);
    if (page.total > page.items.length) console.log(`(${page.items.length} of ${page.total}; raise --limit)`);
  } finally {
    db.close();
  }
  return 0;
}
