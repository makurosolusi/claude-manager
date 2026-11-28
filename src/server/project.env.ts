import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import type { Page, ProjectRow } from "./dashboard.types.ts";
import { describeProject, type PathEnv } from "./project.path.ts";

/** Well-known temp roots beyond os.tmpdir(); /var/folders is macOS's per-user temp area. */
const OS_TMP_DIRS = ["/tmp", "/private/tmp"];
const MACOS_TMP_DIRS = ["/private/var/folders", "/var/folders"];

function realOrSame(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p; // tmpdir missing: classify by the unresolved name
  }
}

/** Home and temp dirs of this machine, read per call so a changed HOME (tests, demo) is honoured; cheap, once per request. */
export function pathEnv(): PathEnv {
  const t = tmpdir();
  const tmpDirs = [t, realOrSame(t), ...OS_TMP_DIRS, ...(process.platform === "darwin" ? MACOS_TMP_DIRS : [])];
  return { home: homedir(), tmpDirs };
}

/** Adds path_display/name/parent/kind/repo to usage rows; pure string work per row. */
export function withProjectPaths(page: Page<Omit<ProjectRow, "path_display" | "name" | "parent" | "kind" | "repo">>): Page<ProjectRow> {
  const env = pathEnv();
  return { ...page, items: page.items.map((r) => ({ ...r, ...describeProject(r.project, env) })) };
}
