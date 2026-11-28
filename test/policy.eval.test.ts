import { describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { decide, effectivePolicy, matrixOf, nodePolicyFs, parseSnapshot } from "../src/policy/policy.eval.ts";
import {
  assertCells, assertOverrides, assertTestCommands, CAPABILITIES, PRESET_NAMES, PUSH_ALLOW_ERROR,
} from "../src/policy/policy.presets.ts";
import type { Capability, Decision, PolicyFs, PresetName } from "../src/policy/policy.types.ts";
import { sha256 } from "../src/storage/json.file.ts";
import { baseConfig, policyConfig, snapshotFor, useProject } from "./policy.eval.fixture.ts";

const { ctx, write, call, bash } = useProject();
const LETTER: Record<string, Decision> = { A: "allow", K: "ask", D: "deny", "-": "default" };
/** Cells in CAPABILITIES order: read edit test shell web agents git push mcp (spec §2.2 table). */
const row = (s: string) => Object.fromEntries(CAPABILITIES.map((c, i) => [c, LETTER[s[i]!]!])) as Record<Capability, Decision>;
const SPEC: Record<PresetName, Record<string, string>> = {
  strict: {
    main: "-------K-", unknown: "-------K-", manager: "A----A-K-", architect: "AD-DK--K-", researcher: "AD-DK--K-",
    coder: "AKKKKKKKK", reviewer: "ADK----K-", writer: "AK-----K-", deep: "AD-DK--K-", impl: "AKKKKKKKK", docs: "AK-----K-",
  },
  balanced: {
    main: "-------K-", unknown: "-------K-", manager: "A----A-K-", architect: "AD-DA--K-", researcher: "AD-DA--K-",
    coder: "AAAKK-KK-", reviewer: "ADAK---K-", writer: "AA-D---K-", deep: "AD-DA--K-", impl: "AAAKK-KK-", docs: "AA-D---K-",
  },
  autonomous: {
    main: "-------K-", unknown: "-------K-", manager: "A----A-K-", architect: "A---A--K-", researcher: "A---A--K-",
    coder: "AAAAA-AK-", reviewer: "ADAA---K-", writer: "AA--A--K-", deep: "A---A--K-", impl: "AAAAA-AK-", docs: "AA--A--K-",
  },
};
const customs = { deep: { tier: "think", description: "d" }, impl: { tier: "work", description: "i" }, docs: { tier: "basic", description: "w" } } as const;

describe("effectivePolicy: presets (§2.2)", () => {
  for (const preset of PRESET_NAMES) {
    test(`${preset} matches the spec table, customs by tier`, () => {
      const rows = effectivePolicy({ ...baseConfig({ customRoles: customs }), policy: policyConfig(preset) });
      expect(rows.map((r) => r.row)).toEqual(["main", "manager", "architect", "researcher", "coder", "reviewer", "writer", "deep", "impl", "docs", "unknown"]);
      expect(rows.map((r) => r.kind)).toEqual(["main", ...Array(6).fill("preset"), "custom", "custom", "custom", "unknown"]);
      const matrix = matrixOf(rows);
      for (const [name, cells] of Object.entries(SPEC[preset])) expect([name, matrix[name]]).toEqual([name, row(cells)]);
    });
  }

  test("no policy previews Balanced; an invalid preset name falls back to Strict", () => {
    expect(matrixOf(effectivePolicy(baseConfig())).coder).toEqual(row(SPEC.balanced.coder!));
    const bad = { ...policyConfig("balanced"), preset: "yolo" as PresetName };
    expect(matrixOf(effectivePolicy({ ...baseConfig(), policy: bad })).coder).toEqual(row(SPEC.strict.coder!));
  });

  test("overrides apply with source; push allow and junk are ignored; disabled and reserved-name roles get no row", () => {
    const overrides = { coder: { shell: "allow", push: "allow", web: "nope" }, ghost: { read: "deny" }, unknown: { read: "deny" } } as never;
    const rows = effectivePolicy({
      ...baseConfig({ disabledRoles: ["writer"], customRoles: { main: { tier: "work", description: "x" } } }),
      policy: policyConfig("balanced", overrides),
    });
    const coder = rows.find((r) => r.row === "coder")!;
    expect(coder.cells.shell).toEqual({ decision: "allow", source: "override" });
    expect(coder.cells.push).toEqual({ decision: "ask", source: "preset" });
    expect(coder.cells.web).toEqual({ decision: "ask", source: "preset" });
    expect(rows.find((r) => r.row === "unknown")!.cells.read.decision).toBe("deny");
    expect(rows.map((r) => r.row)).not.toContain("writer");
    expect(rows.map((r) => r.row)).not.toContain("ghost");
    expect(rows.filter((r) => r.row === "main")).toHaveLength(1);
  });
});

describe("validation (§4.4)", () => {
  test("push can never be set to allow", () => {
    expect(() => assertCells({ push: "allow" })).toThrow(PUSH_ALLOW_ERROR);
    expect(() => assertOverrides({ coder: { push: "allow" } })).toThrow(PUSH_ALLOW_ERROR);
    expect(() => assertCells({ push: "deny", edit: "allow" })).not.toThrow();
  });
  test("bad capability, decision or shape is rejected", () => {
    expect(() => assertCells({ sudo: "allow" })).toThrow(/unknown capability/);
    expect(() => assertCells({ edit: "yes" })).toThrow(/bad decision/);
    expect(() => assertOverrides([])).toThrow(/expected an object/);
    expect(() => assertOverrides({ coder: "allow" })).toThrow(/expected an object/);
  });
  test("testCommands: count, length and shell metacharacters", () => {
    expect(() => assertTestCommands(["bun test", "make check"])).not.toThrow();
    expect(() => assertTestCommands(Array(33).fill("bun test"))).toThrow(/at most 32/);
    expect(() => assertTestCommands(["x".repeat(81)])).toThrow(/80 characters/);
    expect(() => assertTestCommands([""])).toThrow(/non-empty/);
    for (const bad of ["bun test; rm -rf /", "bun test && x", "bun test | x", "bun test $(x)", "a > b", "it's"]) {
      expect(() => assertTestCommands([bad])).toThrow(/metacharacters/);
    }
  });
});

/** One representative tool call per capability. */
const probe = (cap: Capability): [string, unknown] => ({
  read: ["Read", { file_path: join(ctx.project, "a.ts") }], edit: ["Edit", { file_path: join(ctx.project, "a.ts") }],
  test: ["Bash", { command: "bun test" }], shell: ["Bash", { command: "ls -la" }], web: ["WebFetch", { url: "https://x.dev" }],
  agents: ["Agent", { subagent_type: "coder" }], git: ["Bash", { command: "git commit -m wip" }],
  push: ["Bash", { command: "git push" }], mcp: ["mcp__github__create_issue", {}],
} as Record<Capability, [string, unknown]>)[cap];

describe("decide: preset × capability (§2.2 via §3)", () => {
  for (const preset of PRESET_NAMES) {
    test(`${preset}: every worker row and capability decides as its cell (push → ask)`, () => {
      const snap = snapshotFor(preset);
      for (const [name, cells] of Object.entries(SPEC[preset])) {
        if (name === "main" || !(name in snap.matrix)) continue;
        CAPABILITIES.forEach((cap, i) => {
          const got = call(snap, name, ...probe(cap));
          expect([preset, name, cap, got.decision]).toEqual([preset, name, cap, LETTER[cells[i]!]!]);
          expect(got.cap).toBe(cap);
        });
      }
    });
  }
  test("an unknown tool has no decision", () => {
    expect(call(snapshotFor("autonomous"), "coder", "Skill", {})).toMatchObject({ decision: "default", cap: null, rule: "unknown-tool" });
  });
});

describe("row selection (§3 rows 1-2)", () => {
  const snap = snapshotFor("autonomous", { unknown: { shell: "deny" } });
  const shell = (agent_type: unknown, more = {}) => call(snap, agent_type, "Bash", { command: "ls -la" }, more);

  test("no agent_id → main, even with agent_type (claude --agent manager)", () => {
    expect(shell("coder", { agent_id: undefined })).toMatchObject({ row: "main", decision: "default" });
    expect(shell("coder", { agent_id: null })).toMatchObject({ row: "main" });
    expect(decide({ tool_name: "Bash", tool_input: { command: "ls" } }, snap, failFs, {}).row).toBe("main");
  });
  test("a valid managed name gets its row", () => {
    expect(shell("coder")).toMatchObject({ row: "coder", decision: "allow", rule: "role:coder.shell" });
  });
  test("malicious, plugin, reserved, disabled and missing names → unknown", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "plugin:coder", "", "c".repeat(65),
      "c".repeat(300), "../../x", "co..der", "Coder", "main", "unknown", "ghost", 42, null, undefined, { coder: 1 }]) {
      expect([name, shell(name).row, shell(name).decision]).toEqual([name, "unknown", "deny"]);
    }
  });
  test("an own __proto__ key in a tampered snapshot still doesn't resolve", () => {
    const allow = JSON.stringify(Object.fromEntries(CAPABILITIES.map((c) => [c, "allow"])));
    const bad = parseSnapshot(`{"version":1,"matrix":{"__proto__":${allow}},"testCommands":[],"ownerOnly":[],"owned":{}}`);
    expect(call(bad, "__proto__", "Bash", { command: "ls" })).toMatchObject({ row: "unknown", decision: "default" });
  });
});

describe("shadow check (§3 row 3)", () => {
  const agents = () => join(ctx.project, ".claude", "agents");
  const edit = (snap = snapshotFor("balanced"), more = {}) => call(snap, "coder", "Edit", { file_path: join(ctx.project, "a.ts") }, more);

  test("an unowned repo coder.md → unknown, rule shadowed", () => {
    write(join(agents(), "coder.md"), "---\nname: coder\n---\nhostile");
    expect(edit()).toMatchObject({ row: "unknown", decision: "default", rule: "shadowed" });
  });
  test("the owned, unedited file keeps the coder row; an edited one doesn't", () => {
    const file = join(agents(), "coder.md");
    write(file, "managed");
    expect(edit(snapshotFor("balanced", {}, { owned: { [file]: sha256("managed") } }))).toMatchObject({ row: "coder", decision: "allow" });
    expect(edit(snapshotFor("balanced", {}, { owned: { [file]: sha256("other") } }))).toMatchObject({ row: "unknown", rule: "shadowed" });
  });
  test("another file whose frontmatter name is coder shadows too", () => {
    write(join(agents(), "helper.md"), "---\nname: coder\ndescription: x\n---\nbody");
    write(join(agents(), "fine.md"), "---\nname: fine\n---\n");
    expect(edit().row).toBe("unknown");
  });
  test("a dangling coder.md symlink shadows", () => {
    write(join(agents(), "keep.md"), "---\nname: keep\n---\n");
    symlinkSync(join(ctx.outside, "gone.md"), join(agents(), "coder.md"));
    expect(edit().rule).toBe("shadowed");
  });
  test("CLAUDE_PROJECT_DIR and the snapshot projectDir are checked, not only cwd", () => {
    write(join(agents(), "coder.md"), "hostile");
    const sub = join(ctx.project, "src");
    write(join(sub, "x.ts"));
    const env = { HOME: ctx.home, CLAUDE_PROJECT_DIR: ctx.project };
    const input = { agent_id: "a", agent_type: "coder", tool_name: "Bash", tool_input: { command: "ls" }, cwd: sub };
    expect(decide(input, snapshotFor("autonomous"), nodeFs(), env).row).toBe("unknown");
    expect(decide(input, snapshotFor("autonomous", {}, { projectDir: ctx.project }), nodeFs(), { HOME: ctx.home }).row).toBe("unknown");
    expect(decide(input, snapshotFor("autonomous"), nodeFs(), { HOME: ctx.home }).row).toBe("coder");
  });
});

describe("secret floor (§3 step 1, §4.4)", () => {
  const snap = snapshotFor("autonomous");
  test("worker file tools on secret paths are denied", () => {
    for (const p of [".env", ".env.local", ".env.example", "config/server.pem", "certs/tls.KEY", "a.p12", "credentials.json",
      "gcp/service-account.json", join(ctx.home, ".ssh", "id_rsa"), join(ctx.home, ".aws", "config")]) {
      for (const tool of ["Read", "Edit", "Write"]) expect([p, tool, call(snap, "coder", tool, { file_path: p }).decision]).toEqual([p, tool, "deny"]);
    }
    expect(call(snap, "coder", "Grep", { pattern: "KEY", path: ".env" })).toMatchObject({ decision: "deny", rule: "secret" });
  });
  test("a symlink pointing at .env is denied through realpath", () => {
    write(join(ctx.project, ".env"), "SECRET=1");
    symlinkSync(join(ctx.project, ".env"), join(ctx.project, "notes.txt"));
    expect(call(snap, "coder", "Edit", { file_path: "notes.txt" })).toMatchObject({ decision: "deny", rule: "secret" });
  });
  test("Bash commands that mention secrets are denied, even with shell allow", () => {
    for (const c of ["cat .env", "cat .e\"\"nv", "cat .\\env", "grep -r TOKEN .env.local", "cat ~/.ssh/id_ed25519", "ls ~/.aws",
      "openssl x509 -in tls.pem", "cp credentials.json /tmp"]) {
      expect([c, bash(snap, "coder", c).decision]).toEqual([c, "deny"]);
    }
  });
  test("main gets no hook decision (settings deny rules cover it)", () => {
    const main = decide({ tool_name: "Bash", tool_input: { command: "cat .env" }, cwd: ctx.project }, snap, nodeFs(), {});
    expect(main).toMatchObject({ row: "main", decision: "default", rule: "secret" });
  });
  test(".envrc and env.ts are not secrets", () => {
    expect(call(snap, "coder", "Edit", { file_path: ".envrc" }).decision).toBe("allow");
    expect(call(snap, "coder", "Edit", { file_path: "src/env.ts" }).decision).toBe("allow");
  });
});

describe("edit scope (§3 step 3)", () => {
  const snap = snapshotFor("balanced");
  const edit = (file_path: unknown, s = snap, more = {}) => call(s, "coder", "Edit", { file_path }, more);

  test("inside the project (new nested path, relative or absolute) → allow", () => {
    expect(edit("src/deep/new.ts")).toMatchObject({ decision: "allow", rule: "role:coder.edit" });
    expect(edit(join(ctx.project, "README.md")).decision).toBe("allow");
    expect(call(snap, "coder", "NotebookEdit", { notebook_path: "n.ipynb" }).decision).toBe("allow");
  });
  test("`..`, absolute outside, .git, .claude and missing paths → no allow", () => {
    for (const p of ["../outside/x.ts", "src/../../outside/x.ts", join(ctx.outside, "x.ts"), "/etc/hosts", ".git/hooks/pre-commit",
      ".GIT/config", ".claude/settings.local.json", "sub/.claude/agents/x.md", ".", undefined, 7, "a\0b"]) {
      expect([p, edit(p).decision]).toEqual([p, "default"]);
    }
    expect(edit("../x.ts").rule).toBe("outside-project");
  });
  test("symlink escapes are caught by realpath", () => {
    symlinkSync(ctx.outside, join(ctx.project, "linkdir"));
    write(join(ctx.outside, "real.ts"));
    symlinkSync(join(ctx.outside, "real.ts"), join(ctx.project, "linkfile.ts"));
    symlinkSync(join(ctx.outside, "nope", "x.ts"), join(ctx.project, "dangling.ts"));
    for (const p of ["linkdir/x.ts", "linkdir/new/y.ts", "linkfile.ts", "dangling.ts"]) expect([p, edit(p).decision]).toEqual([p, "default"]);
  });
  test("the scope root is projectDir when set; HOME and / are never a scope", () => {
    const sub = join(ctx.project, "sub");
    write(join(sub, "a.ts"));
    const scoped = snapshotFor("balanced", {}, { projectDir: sub });
    expect(edit(join(sub, "a.ts"), scoped).decision).toBe("allow");
    expect(edit(join(ctx.project, "b.ts"), scoped).decision).toBe("default");
    expect(edit(join(ctx.home, ".zshrc"), snap, { cwd: ctx.home }).decision).toBe("default");
    expect(edit("/tmp/x", snap, { cwd: "/" }).decision).toBe("default");
  });
  test("outside the project only drops allow: a deny cell still denies (safer reading of §3 step 3)", () => {
    expect(call(snap, "reviewer", "Edit", { file_path: "/etc/hosts" }).decision).toBe("deny");
  });
});

describe("output, purity and snapshot parsing (§3, §2.6)", () => {
  test("the reason never echoes the input", () => {
    const snap = snapshotFor("autonomous");
    for (const r of [bash(snap, "coder", "ls -la /tmp/MARKER-xyz"), call(snap, "coder", "Edit", { file_path: "MARKER-xyz.md" }),
      bash(snap, "coder", "cat MARKER-xyz.env"), bash(snap, "coder", "git push MARKER-xyz")]) {
      expect(r.decision).not.toBe("default");
      expect(r.reason).toStartWith("claude-manager policy:");
      expect(JSON.stringify(r)).not.toContain("MARKER");
    }
  });
  test("decide only touches the injected fs", () => {
    const seen: string[] = [];
    const fake: PolicyFs = {
      realpath: (p) => (seen.push(p), p.startsWith("/virtual") ? p : null), lexists: () => false,
      readText: (p) => (seen.push(p), p === "/virtual/.claude/agents/coder.md" ? "hostile" : null),
      listDir: (p) => (seen.push(p), p === "/virtual/.claude/agents" ? ["coder.md"] : null),
    };
    const r = decide({ agent_id: "a", agent_type: "coder", tool_name: "Bash", tool_input: { command: "ls" }, cwd: "/virtual" }, snapshotFor("autonomous"), fake);
    expect(r).toMatchObject({ row: "unknown", rule: "shadowed" });
    expect(seen.every((p) => p.startsWith("/virtual"))).toBe(true);
  });
  test("parseSnapshot rejects bad JSON, versions and shapes", () => {
    const good = JSON.stringify(snapshotFor("balanced"));
    expect(parseSnapshot(good).matrix.coder!.edit).toBe("allow");
    expect(() => parseSnapshot("{oops")).toThrow();
    for (const bad of [{ version: 2 }, { matrix: [] }, { testCommands: [1] }, { owned: { a: 1 } }, { projectDir: 3 }]) {
      expect(() => parseSnapshot(JSON.stringify({ ...JSON.parse(good), ...bad }))).toThrow(/policy snapshot/);
    }
  });
});

const nodeFs = () => nodePolicyFs;
const failFs: PolicyFs = {
  realpath: () => { throw new Error("unexpected fs"); }, lexists: () => { throw new Error("unexpected fs"); },
  readText: () => { throw new Error("unexpected fs"); }, listDir: () => { throw new Error("unexpected fs"); },
};
