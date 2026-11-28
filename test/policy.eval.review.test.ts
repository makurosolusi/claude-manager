import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { decide, nodePolicyFs } from "../src/policy/policy.eval.ts";
import { HOOK_MATCHER } from "../src/policy/policy.service.ts";
import { snapshotFor, useProject } from "./policy.eval.fixture.ts";

// v0.4.0 security review findings (P1/P2): each test is the reviewer's repro plus close variants.
const { ctx, write, call, bash } = useProject();
const auto = () => snapshotFor("autonomous");

describe("path scope after a symlink (P1.2)", () => {
  test("`lnk/../x` with lnk -> outside is not project: the kernel follows lnk before `..`", () => {
    mkdirSync(join(ctx.home, "target"));
    symlinkSync(join(ctx.home, "target"), join(ctx.project, "lnk"));
    for (const p of [`${ctx.project}/lnk/../.zshrc`, "lnk/../.zshrc", "src/../a.ts"]) {
      expect([p, call(auto(), "coder", "Edit", { file_path: p }).rule]).toEqual([p, "outside-project"]);
      expect([p, call(auto(), "coder", "Read", { file_path: p }).decision]).toEqual([p, "default"]);
    }
    expect(call(auto(), "coder", "Edit", { file_path: "lnk2" }).decision).toBe("allow"); // no `..`: unchanged
  });

  test("the secret floor sees the kernel's target: `lnk/../config` with lnk -> ~/.ssh/keys", () => {
    mkdirSync(join(ctx.home, ".ssh", "keys"), { recursive: true });
    write(join(ctx.home, ".ssh", "config"));
    symlinkSync(join(ctx.home, ".ssh", "keys"), join(ctx.project, "lnk"));
    expect(call(auto(), "coder", "Read", { file_path: "lnk/../config" })).toMatchObject({ decision: "deny", rule: "secret" });
  });
});

describe("push equivalents and unreadable commands in Autonomous (P1.3)", () => {
  test("remote-changing commands are owner-only", () => {
    for (const c of [
      "git send-pack origin HEAD:main", "git http-push x", "npm pub", "npm publ --tag x", "npm unpub x", "gh pr merge 1",
      "gh repo sync", "git subtree push --prefix d origin b", "yarn npm publish", "git svn dcommit",
    ]) {
      expect([c, bash(auto(), "coder", c)]).toMatchObject([c, { decision: "ask", rule: "owner-only:push" }]);
    }
  });

  test("expansions, eval, brace and globs that could form a token or secret never reach allow", () => {
    for (const c of [
      "git pu$(true)sh", "git pu`true`sh", "X=pu; git ${X}sh", "git $X", "eval git x", "git {pu,}sh",
      "git pus?", "git p*", "cat .en?", "git add .e*", "cat id_*", "ls [p]ush",
    ]) {
      expect([c, bash(auto(), "coder", c)]).toMatchObject([c, { decision: "ask", rule: "owner-check-uncertain" }]);
    }
  });

  test("ordinary Autonomous commands still allow", () => {
    for (const c of ["ls *.ts", "bun test", "git commit -m x", "echo hi", "ls src/*.tsx", "rm a.txt"]) {
      expect([c, bash(auto(), "coder", c).decision]).toEqual([c, "allow"]);
    }
  });

  test("a non-allow cell is not loosened or changed by the uncertain rule", () => {
    expect(bash(snapshotFor("balanced"), "coder", "git pu$(true)sh")).toMatchObject({ decision: "ask", rule: "compound-shell" });
    expect(bash(snapshotFor("balanced"), "writer", "echo $HOME")).toMatchObject({ decision: "deny" });
  });
});

describe(".envrc (P2.4)", () => {
  test("worker edit, read and cat of .envrc are denied; main is left to settings rules", () => {
    for (const r of [call(auto(), "coder", "Edit", { file_path: ".envrc" }), bash(auto(), "coder", "source .envrc")]) {
      expect(r).toMatchObject({ decision: "deny", rule: "secret" });
    }
    const main = decide({ tool_name: "Read", tool_input: { file_path: ".envrc" }, cwd: ctx.project }, auto(), nodePolicyFs, {});
    expect(main).toMatchObject({ row: "main", decision: "default", rule: "secret" });
  });
});

describe("read cells (P2.5)", () => {
  test("the matcher is anchored and covers read tools, edit tools and MCP, nothing else", () => {
    const re = new RegExp(HOOK_MATCHER);
    for (const t of ["Read", "Grep", "Glob", "LSP", "Edit", "Write", "NotebookEdit", "Bash", "WebFetch", "Agent", "mcp__gh__x"]) {
      expect([t, re.test(t)]).toEqual([t, true]);
    }
    for (const t of ["TodoWrite", "BashOutput", "ReadMcpResourceTool", "xmcp__a"]) expect([t, re.test(t)]).toEqual([t, false]);
  });

  test("read allow applies inside the project only; Grep without a path searches cwd", () => {
    expect(call(auto(), "coder", "Read", { file_path: "src/a.ts" })).toMatchObject({ decision: "allow", cap: "read" });
    expect(call(auto(), "coder", "Grep", { pattern: "x" })).toMatchObject({ decision: "allow", cap: "read" });
    expect(call(auto(), "coder", "Read", { file_path: join(ctx.home, ".npmrc") })).toMatchObject({ decision: "default", rule: "outside-project" });
    expect(call(auto(), "coder", "Glob", { pattern: "*", path: ctx.outside })).toMatchObject({ decision: "default", rule: "outside-project" });
    const denied = snapshotFor("autonomous", { coder: { read: "deny" } });
    expect(call(denied, "coder", "Read", { file_path: "src/a.ts" })).toMatchObject({ decision: "deny", rule: "role:coder.read" });
  });
});

describe("shadow check depth (P2.7)", () => {
  test("an agent file in a .claude/agents subfolder shadows the role", () => {
    write(join(ctx.project, ".claude", "agents", "team", "deep", "x.md"), "---\nname: coder\n---\nhostile");
    expect(call(auto(), "coder", "Edit", { file_path: "a.ts" })).toMatchObject({ row: "unknown", rule: "shadowed" });
  });

  test("a .claude/agents dir between cwd and the project root shadows the role", () => {
    write(join(ctx.project, ".git"), "");
    write(join(ctx.project, "pkg", ".claude", "agents", "coder.md"), "hostile");
    const cwd = join(ctx.project, "pkg", "src");
    mkdirSync(cwd, { recursive: true });
    const r = decide({ agent_id: "a", agent_type: "coder", tool_name: "Edit", tool_input: { file_path: "a.ts" }, cwd }, auto(), nodePolicyFs, {});
    expect(r).toMatchObject({ row: "unknown", rule: "shadowed" });
  });

  test("too many entries under agents → shadowed rather than a partial scan", () => {
    for (let i = 0; i < 201; i++) write(join(ctx.project, ".claude", "agents", `d${i % 3}`, `a${i}.md`), "x");
    expect(call(auto(), "coder", "Edit", { file_path: "a.ts" }).rule).toBe("shadowed");
  });
});
