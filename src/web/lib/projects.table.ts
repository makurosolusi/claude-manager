import type { ProjectRow } from "../../server/dashboard.types.ts";
import { SESSION_STATUSES } from "../../server/dashboard.types.ts";
import { cacheHitRate, fmtProject } from "@/lib/format.ts";
import { sessionStatus } from "@/lib/status.level.ts";
import type { ClientTableOptions } from "@/lib/table.client.ts";
import { NO_GROUP, type TableSpec } from "@/lib/table.query.ts";

/** Hash route of the Projects page. */
export const PROJECTS_PATH = "/projects";
/** Projects fetched in one call; more than this and the page says it shows the top N by cost. */
export const PROJECTS_FETCH_LIMIT = 200;
/** Group value that buckets projects by their parent folder. */
export const GROUP_PARENT = "parent";

/** URL spec of the Projects table: default order is cost, highest first. */
export const PROJECTS_SPEC: TableSpec = {
  sorts: ["cost", "sessions", "requests", "tokens", "last"],
  defaultSort: "cost",
  defaultDir: "desc",
  groups: [NO_GROUP, GROUP_PARENT],
  facets: { status: SESSION_STATUSES },
};

/** Total tokens of a usage row (input + output + both cache kinds). */
export const tokensOf = (r: Pick<ProjectRow, "input" | "output" | "cache_read" | "cache_write">) => r.input + r.output + r.cache_read + r.cache_write;

/** Parent folder of a project: the first segment of its `acme/web` display form (a lone segment is its own parent). */
export const parentOf = (project: string): string => fmtProject(project).split("/")[0] || project;

/** Search, facet and sort accessors for projects; `now` decides each project's live/idle/ended status. */
export function projectTableOptions(now: number): ClientTableOptions<ProjectRow> {
  return {
    text: (r) => r.project,
    facets: { status: (r) => sessionStatus(r.last_ts, now) },
    sort: {
      cost: (r) => r.cost_usd,
      sessions: (r) => r.sessions,
      requests: (r) => r.requests,
      tokens: tokensOf,
      last: (r) => r.last_ts ?? "",
    },
  };
}

/** Subtotals of a set of projects (used for group headers). */
export function projectTotals(rows: ProjectRow[]) {
  const sum = (f: (r: ProjectRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const read = sum((r) => r.cache_read), write = sum((r) => r.cache_write), input = sum((r) => r.input);
  return {
    sessions: sum((r) => r.sessions),
    requests: sum((r) => r.requests),
    tokens: sum(tokensOf),
    cost: sum((r) => r.cost_usd),
    cache: cacheHitRate({ input, cache_read: read, cache_write: write }),
    last: rows.reduce<string | null>((a, r) => (r.last_ts && (!a || r.last_ts > a) ? r.last_ts : a), null),
  };
}
