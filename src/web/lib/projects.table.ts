import type { ProjectRow } from "../../server/dashboard.types.ts";
import { SESSION_STATUSES } from "../../server/dashboard.types.ts";
import { PROJECT_KINDS } from "../../server/project.path.ts";
import { cacheHitRate } from "@/lib/format.ts";
import { sessionStatus } from "@/lib/status.level.ts";
import { groupBy, type ClientTableOptions } from "@/lib/table.client.ts";
import { NO_GROUP, type TableSpec } from "@/lib/table.query.ts";

/** Hash route of the Projects page. */
export const PROJECTS_PATH = "/projects";
/** Projects fetched in one call; more than this and the page says it shows the top N by cost. */
export const PROJECTS_FETCH_LIMIT = 200;
/** Group values. The URL default (NO_GROUP) means Folder, so a bare link is grouped; `flat` is the explicit "No grouping". */
export const GROUP_KIND = "kind";
export const GROUP_FLAT = "flat";
/** What the table groups by once the URL value is resolved. */
export type ProjectGroup = "folder" | "kind" | "none";

/** URL group value -> effective grouping (the table itself only knows NO_GROUP = flat). */
export const groupFromUrl = (g: string): ProjectGroup => (g === NO_GROUP ? "folder" : g === GROUP_KIND ? "kind" : "none");
/** Effective grouping -> URL group value. */
export const groupToUrl = (g: string): string => (g === "folder" ? NO_GROUP : g === GROUP_KIND ? GROUP_KIND : GROUP_FLAT);

/** URL spec of the Projects table: default order is cost, highest first; default grouping is Folder. */
export const PROJECTS_SPEC: TableSpec = {
  sorts: ["cost", "sessions", "requests", "tokens", "last"],
  defaultSort: "cost",
  defaultDir: "desc",
  groups: [NO_GROUP, GROUP_KIND, GROUP_FLAT],
  facets: { status: SESSION_STATUSES, kind: PROJECT_KINDS },
};

/** Total tokens of a usage row (input + output + both cache kinds). */
export const tokensOf = (r: Pick<ProjectRow, "input" | "output" | "cache_read" | "cache_write">) => r.input + r.output + r.cache_read + r.cache_write;

const dirOf = (display: string) => (display.lastIndexOf("/") > 0 ? display.slice(0, display.lastIndexOf("/")) : display.startsWith("/") ? "/" : display);

/** Folder a project is listed under; a worktree with a known repo sits in its repo's folder, next to the repo. */
export const folderOf = (r: Pick<ProjectRow, "kind" | "repo" | "parent">): string => (r.kind === "worktree" && r.repo ? dirOf(r.repo) : r.parent);

/** Named buckets for kinds whose literal parent folder means nothing; each has a fixed label and sorts after folder groups in this order. */
export const BUCKETS = {
  other: { label: "Outside home", rank: 1 },
  temp: { label: "Temporary directories", rank: 2 },
  home: { label: "Home directory (~)", rank: 3 },
} as const;
type BucketKind = keyof typeof BUCKETS;

/** Folder-grouping bucket of a project: project/worktree use their folder, other kinds a named bucket (never a literal parent). */
export function bucketOf(r: Pick<ProjectRow, "kind" | "repo" | "parent">): { key: string; label: string; rank: number } {
  if (r.kind in BUCKETS) { const b = BUCKETS[r.kind as BucketKind]; return { key: r.kind, label: b.label, rank: b.rank }; }
  const folder = folderOf(r);
  return { key: folder, label: folder, rank: 0 };
}

/** Rows regrouped by bucket: folder groups first (by cost, highest first), then Outside home, Temporary directories and Home. */
export function orderBuckets(rows: ProjectRow[]): ProjectRow[] {
  const rankOf = (g: ProjectRow[]) => bucketOf(g[0]!).rank;
  return groupBy(rows, (r) => bucketOf(r).key).map((g) => ({ g: g.rows, cost: projectTotals(g.rows).cost })).sort((a, b) => rankOf(a.g) - rankOf(b.g) || b.cost - a.cost).flatMap((x) => x.g);
}

/** Rows regrouped so each group is contiguous and groups run by total cost, highest first (row order inside a group is kept). */
export function orderGroups(rows: ProjectRow[], key: (r: ProjectRow) => string): ProjectRow[] {
  return groupBy(rows, key).map((g) => ({ g, cost: projectTotals(g.rows).cost })).sort((a, b) => b.cost - a.cost).flatMap((x) => x.g.rows);
}

/** Search, facet and sort accessors for projects; `now` decides each project's live/idle/ended status. */
export function projectTableOptions(now: number): ClientTableOptions<ProjectRow> {
  return {
    text: (r) => `${r.path_display} ${r.name}`,
    facets: { status: (r) => sessionStatus(r.last_ts, now), kind: (r) => r.kind },
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
