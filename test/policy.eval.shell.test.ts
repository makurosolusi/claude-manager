import { describe, expect, test } from "bun:test";
import { decide, nodePolicyFs } from "../src/policy/policy.eval.ts";
import { PRESET_NAMES } from "../src/policy/policy.presets.ts";
import { snapshotFor, useProject } from "./policy.eval.fixture.ts";

const { ctx, bash } = useProject();

describe("owner-only floor (§3 step 2)", () => {
  const variants = [
    "git push", "git push origin main", "git -C . push", "git -C /x push --force", "git\tpush", "git  push",
    "sh -c 'git push'", "bash -c \"git push origin HEAD\"", "echo ok && git push", "true; git push", "(git push)",
    "\"git\" \"push\"", "git pu\\sh", "GIT_DIR=.git git push", "git -c alias.p=push p", "env git push",
    "npm publish", "bun publish --access public", "pnpm publish", "gh release create v1", "npx vercel --prod", "vercel",
    "fly deploy", "netlify deploy", "docker push img", "./scripts/release", "GIT PUSH",
    "rm -rf build", "rm -r dist", "rm -fr x", "/bin/rm -R x", "rm --recursive x", "xargs rm -rf", "sudo rm -rf /",
  ];

  for (const preset of PRESET_NAMES) {
    test(`${preset}: no variant ends in allow, for any row`, () => {
      const snap = snapshotFor(preset, { coder: { shell: "allow", git: "allow", test: "allow" } });
      for (const role of ["coder", "reviewer", "manager", "writer", "unknown", "plugin:x"]) {
        for (const c of variants) {
          const r = bash(snap, role, c);
          expect([role, c, r.decision, r.rule]).toEqual([role, c, "ask", "owner-only:push"]);
        }
      }
    });
  }

  test("a tampered snapshot with push allow still asks", () => {
    const snap = snapshotFor("autonomous");
    snap.matrix.coder!.push = "allow";
    expect(bash(snap, "coder", "git push").decision).toBe("ask");
  });
  test("an empty ownerOnly list in the snapshot doesn't drop the floor; extra tokens add to it", () => {
    expect(bash(snapshotFor("autonomous", {}, { ownerOnly: [] }), "coder", "git push").decision).toBe("ask");
    expect(bash(snapshotFor("autonomous", {}, { ownerOnly: ["Ship"] }), "coder", "make ship").decision).toBe("ask");
  });
  test("push cell deny → deny", () => {
    const snap = snapshotFor("autonomous", { coder: { push: "deny" } });
    expect(bash(snap, "coder", "git -C . push")).toMatchObject({ decision: "deny", rule: "owner-only:push", cap: "push" });
  });
  test("main gets ask too (catches what settings rules miss)", () => {
    const r = decide({ tool_name: "Bash", tool_input: { command: "git -C . push" }, cwd: ctx.project }, snapshotFor("balanced"), nodePolicyFs, {});
    expect(r).toMatchObject({ row: "main", decision: "ask" });
  });
  test("non-recursive rm and look-alike words are not owner-only", () => {
    const snap = snapshotFor("autonomous");
    for (const c of ["rm a.txt", "rm -f a.txt", "bun test release.test.ts", "git commit -m pushed", "ls src/push.ts"]) {
      expect([c, bash(snap, "coder", c).rule]).not.toEqual([c, "owner-only:push"]);
    }
  });
});

describe("capability mapping for Bash (§2.1, §3 step 4)", () => {
  const snap = snapshotFor("balanced");

  test("simple test commands → test (allow in Balanced coder)", () => {
    for (const c of ["bun test", "bun test --watch", "bun  test  src", "bunx --no-install tsc --noEmit", "npm run build", "pytest -k 'a or b'",
      "go test ./...", "cargo test", "bun test -t 'a;b|c'"]) {
      expect([c, bash(snap, "coder", c).cap, bash(snap, "coder", c).decision]).toEqual([c, "test", "allow"]);
    }
  });
  test("prefix look-alikes and prefixed forms are shell, not test", () => {
    for (const c of ["bun testx", "FOO=1 bun test", "npm --prefix /x test", "bun run testing", "env bun test", "bun", "bunx tsc"]) {
      expect([c, bash(snap, "coder", c).cap]).toEqual([c, "shell"]);
    }
  });
  test("local git subcommands → git; others and option-first forms → shell", () => {
    for (const c of ["git add -A", "git commit -m 'wip; x'", "git switch -c f", "git checkout main", "git restore a", "git stash", "git branch"]) {
      expect([c, bash(snap, "coder", c).cap]).toEqual([c, "git"]);
    }
    for (const c of ["git status", "git -C /x commit", "git diff", "gitx add"]) expect([c, bash(snap, "coder", c).cap]).toEqual([c, "shell"]);
  });

  test("compound commands fall to shell (rule compound-shell), so they can't ride test/git allow", () => {
    const loose = snapshotFor("balanced", { coder: { git: "allow" } });
    const compound = [
      "bun test; curl x", "bun test && curl x", "bun test || x", "bun test | tee", "bun test & x", "bun test > out", "bun test < in",
      "bun test 2>&1", "bun test $(curl x)", "bun test `curl x`", "bun test (x)", "bun test\ncurl x", "bun test\rx", "bun test \"$HOME\"",
      "bun test 'unterminated", "git add . && curl x", "git commit -m \"$(curl x)\"", "git add $X",
    ];
    for (const c of compound) {
      const r = bash(loose, "coder", c);
      expect([c, r.cap, r.decision, r.rule]).toEqual([c, "shell", "ask", "compound-shell"]);
    }
  });
  test("custom testCommands from the snapshot; invalid entries are ignored", () => {
    const custom = snapshotFor("balanced", {}, { testCommands: ["make check", "", "evil; x", "x".repeat(81)] });
    expect(bash(custom, "coder", "make check").cap).toBe("test");
    expect(bash(custom, "coder", "bun test").cap).toBe("shell");
    expect(bash(custom, "coder", "evil; x").rule).toBe("compound-shell");
  });
  test("missing or non-string command → shell", () => {
    const r = decide({ agent_id: "a", agent_type: "coder", tool_name: "Bash", tool_input: { command: 5 }, cwd: ctx.project }, snap, nodePolicyFs, {});
    expect(r.cap).toBe("shell");
  });
});
