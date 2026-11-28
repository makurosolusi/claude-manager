// Pure path classification shared by the server (enriches /api/projects) and the web bundle (kind list). No node imports.

/** What a project cwd is: a real project, an agent worktree, a temp dir, the home dir itself, or something outside home. */
export const PROJECT_KINDS = ["project", "worktree", "temp", "home", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** Machine facts the classification needs; the browser cannot know them. */
export interface PathEnv { home: string; tmpDirs: string[] }

export interface ProjectPath {
  /** Full cwd with the home dir shown as `~`. */
  path_display: string;
  /** Basename of the cwd. */
  name: string;
  /** Display path of the parent directory. */
  parent: string;
  kind: ProjectKind;
  /** Display path of the repo a worktree belongs to (`<repo>/.claude/worktrees/x`, `<repo>/.git/worktrees/x`); else null. */
  repo: string | null;
}

const WORKTREE_REPO = /^(.+?)\/\.(?:claude|git)\/worktrees(?:\/|$)/;
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : p);
const under = (p: string, dir: string) => dir !== "/" && dir !== "" && (p === dir || p.startsWith(`${dir}/`));
const dirname = (p: string) => (p.lastIndexOf("/") > 0 ? p.slice(0, p.lastIndexOf("/")) : "/");

/** Classifies a cwd. Home wins over temp, so a HOME that lives under /var/folders still holds real projects. */
export function describeProject(cwd: string, env: PathEnv): ProjectPath {
  const p = trimSlash(cwd);
  const home = trimSlash(env.home);
  const show = (x: string) => (under(x, home) ? `~${x.slice(home.length)}` : x);
  const hasWorktrees = p.split("/").includes("worktrees");
  const kind: ProjectKind =
    p === home || p === "/" ? "home"
    : under(p, home) ? (hasWorktrees ? "worktree" : "project")
    : env.tmpDirs.some((t) => under(p, trimSlash(t))) ? "temp"
    : hasWorktrees ? "worktree"
    : "other";
  const repo = kind === "worktree" ? WORKTREE_REPO.exec(p)?.[1] : undefined;
  return { path_display: show(p), name: p.slice(p.lastIndexOf("/") + 1) || p, parent: show(dirname(p)), kind, repo: repo ? show(repo) : null };
}
