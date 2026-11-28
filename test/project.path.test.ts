import { describe, expect, test } from "bun:test";
import { describeProject, type PathEnv } from "../src/server/project.path.ts";

// test-only: synthetic machine layout, never the real HOME.
const env: PathEnv = { home: "/Users/me", tmpDirs: ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"] };
const d = (cwd: string, e = env) => describeProject(cwd, e);

describe("describeProject", () => {
  test("project under home shows ~ and splits name and parent", () => {
    expect(d("/Users/me/work/acme/web")).toEqual({ path_display: "~/work/acme/web", name: "web", parent: "~/work/acme", kind: "project", repo: null });
    expect(d("/Users/me/code").parent).toBe("~");
  });

  test("home dir itself and the filesystem root are kind home", () => {
    expect(d("/Users/me")).toMatchObject({ path_display: "~", kind: "home", parent: "/Users" });
    expect(d("/")).toMatchObject({ kind: "home", name: "/" });
  });

  test("a trailing slash changes nothing", () => {
    expect(d("/Users/me/work/acme/web/")).toEqual(d("/Users/me/work/acme/web"));
    expect(d("/Users/me/")).toMatchObject({ kind: "home", path_display: "~" });
  });

  test("macOS /var/folders paths are temp", () => {
    expect(d("/var/folders/xx/vncl95fd4h59vq771z5plcv40000gn/T").kind).toBe("temp");
    expect(d("/private/var/folders/xx/yy/T/scratch").kind).toBe("temp");
    expect(d("/tmp/demo").kind).toBe("temp");
  });

  test("home wins over temp when HOME itself lives in a temp dir", () => {
    const tmpHome: PathEnv = { home: "/var/folders/xx/yy/T/cm-home-1", tmpDirs: env.tmpDirs };
    expect(d("/var/folders/xx/yy/T/cm-home-1/work/acme/api", tmpHome)).toMatchObject({ kind: "project", path_display: "~/work/acme/api" });
    expect(d("/var/folders/xx/yy/T/cm-home-1", tmpHome).kind).toBe("home");
    expect(d("/var/folders/xx/yy/T/other", tmpHome).kind).toBe("temp");
  });

  test(".claude/worktrees and .git/worktrees resolve their repo", () => {
    expect(d("/Users/me/work/acme/web/.claude/worktrees/task-1")).toEqual({
      path_display: "~/work/acme/web/.claude/worktrees/task-1", name: "task-1", parent: "~/work/acme/web/.claude/worktrees", kind: "worktree", repo: "~/work/acme/web",
    });
    expect(d("/Users/me/api/.git/worktrees/fix").repo).toBe("~/api");
  });

  test("other worktrees dirs are worktree kind without a repo", () => {
    expect(d("/Users/me/.codex/worktrees/abc")).toMatchObject({ kind: "worktree", repo: null });
    expect(d("/srv/x/worktrees/y")).toMatchObject({ kind: "worktree", repo: null });
  });

  test("outside home and not temp is other; a lookalike prefix is not home", () => {
    expect(d("/srv/app").kind).toBe("other");
    expect(d("/Users/mellow/app")).toMatchObject({ kind: "other", path_display: "/Users/mellow/app" });
  });
});
