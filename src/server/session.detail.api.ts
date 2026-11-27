import type { Database } from "bun:sqlite";
import * as detail from "../db/session.detail.repository.ts";
import { sessionAgents, sessionById } from "../db/dashboard.repository.ts";
import { contextWindow } from "./context.window.ts";
import { HTTP, HttpError, MAX_QUERY_CHARS, pageQuery } from "./dashboard.params.ts";
import { FAMILIES, REQUEST_GROUPS, type ApiError } from "./dashboard.types.ts";
import {
  REQUEST_SORTS, type RequestDimension, type RequestFilter, type RequestGroupBy, type RequestGroups, type RequestQuery,
  type RequestsResponse, type SessionDetailFull,
} from "./session.detail.types.ts";

/** Max values per repeatable filter param. */
export const MAX_FACET_VALUES = 20;
const MAX_VALUE_CHARS = 512;
const SORT_DIRS = ["asc", "desc"] as const;
const SESSION_PATH = /^\/api\/sessions\/([^/]+)(?:\/(requests)(?:\/(groups))?)?$/;

const bad = (message: string) => new HttpError(HTTP.badRequest, message);
const oneOf = <T extends string>(name: string, values: readonly T[], raw: string): T => {
  if (!(values as readonly string[]).includes(raw)) throw bad(`invalid ${name} "${raw}": use one of ${values.join(", ")}`);
  return raw as T;
};

/** Repeatable filter params (each list capped by count and length; family values must be known families) plus the `q` search. */
function filters(url: URL): RequestFilter {
  const f: RequestFilter = {};
  for (const name of ["family", "agent", "stop", "tool"] as const satisfies RequestDimension[]) {
    const values = url.searchParams.getAll(name);
    if (!values.length) continue;
    if (values.length > MAX_FACET_VALUES) throw bad(`invalid ${name}: use at most ${MAX_FACET_VALUES} values`);
    for (const v of values) {
      if (v.length > MAX_VALUE_CHARS) throw bad(`invalid ${name}: each value must be at most ${MAX_VALUE_CHARS} characters`);
      if (name === "family") oneOf(name, FAMILIES, v);
    }
    f[name] = values;
  }
  const q = url.searchParams.get("q")?.trim();
  if (q && q.length > MAX_QUERY_CHARS) throw bad(`invalid q: use at most ${MAX_QUERY_CHARS} characters`);
  if (q) f.q = q;
  return f;
}

function requestQuery(url: URL): RequestQuery {
  const sort = url.searchParams.get("sort") ?? "ts";
  const dir = url.searchParams.get("dir") ?? "desc";
  return { sort: oneOf("sort", REQUEST_SORTS, sort), dir: oneOf("dir", SORT_DIRS, dir) };
}

function requireSession(db: Database, id: string) {
  const session = sessionById(db, id);
  if (!session) throw new HttpError(HTTP.notFound, "session not found");
  return session;
}

function sessionDetail(db: Database, id: string): SessionDetailFull {
  const session = requireSession(db, id);
  const sample = detail.latestContext(db, id);
  return {
    session,
    agents: sessionAgents(db, id),
    models: detail.sessionModels(db, id),
    tools: detail.sessionTools(db, id),
    compactions: detail.sessionCompactions(db, id),
    context: sample ? { used: sample.used, window: contextWindow(sample.model, sample.max_used) } : null,
  };
}

function requests(db: Database, id: string, url: URL): RequestsResponse {
  const p = pageQuery(url);
  const q = requestQuery(url);
  const f = filters(url);
  requireSession(db, id);
  const page = detail.requestsPage(db, id, f, q, p);
  return { ...page, page: p.page, pageSize: p.pageSize, ...(url.searchParams.get("facets") === "1" && { facets: detail.requestFacets(db, id, f) }) };
}

function groups(db: Database, id: string, url: URL): RequestGroups {
  const by: RequestGroupBy = oneOf("by", REQUEST_GROUPS, url.searchParams.get("by") ?? "");
  const f = filters(url);
  requireSession(db, id);
  return { by, ...detail.requestGroups(db, id, by, f) };
}

/** Serves /api/sessions/:id, /requests and /requests/groups; undefined for any other path. */
export function routeSessionDetail(db: Database, path: string, url: URL): Response | undefined {
  const m = SESSION_PATH.exec(path.replace(/\/+$/, ""));
  if (!m) return undefined;
  const id = m[1]!;
  try {
    return Response.json(m[3] ? groups(db, id, url) : m[2] ? requests(db, id, url) : sessionDetail(db, id));
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message } satisfies ApiError, { status: err.status });
    throw err;
  }
}
