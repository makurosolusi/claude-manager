import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// test-only: hand-written snapshot so these tests don't depend on how the matrix is compiled.
const row = (o: Record<string, string>) => ({ read: "allow", edit: "default", test: "default", shell: "default", web: "default", agents: "default", git: "default", push: "ask", mcp: "default", ...o });

export function makeSnapshot(project: string) {
  return {
    version: 1,
    matrix: { main: row({}), unknown: row({}), coder: row({ edit: "allow", web: "ask", shell: "deny", mcp: "ask" }) },
    testCommands: ["bun test"],
    ownerOnly: ["push", "publish", "deploy", "release"],
    owned: {},
    projectDir: project,
  };
}

/** Temp HOME with app dir, project dir and (optionally) a snapshot; runs the real CLI entry in a subprocess. */
export function hookEnv(withSnapshot = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cm-hook-")));
  const home = join(root, "home");
  const app = join(home, ".claude-manager");
  const project = join(root, "project");
  mkdirSync(app, { recursive: true });
  mkdirSync(project, { recursive: true });
  if (withSnapshot) writeFileSync(join(app, "policy.compiled.json"), JSON.stringify(makeSnapshot(project)));
  const env = { PATH: process.env.PATH ?? "", HOME: home, CLAUDE_MANAGER_HOME: app, CLAUDE_PROJECT_DIR: project };
  const auditLines = (): string[] => {
    try {
      return readFileSync(join(app, "policy-audit.jsonl"), "utf8").split("\n").filter(Boolean);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  };
  return { root, home, app, project, env, auditLines, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export async function runHookProc(cmd: string[], env: Record<string, string>, stdin: string) {
  const proc = Bun.spawn([...cmd, "hook", "pre-tool-use"], { env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}
