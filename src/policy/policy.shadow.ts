import { basename, dirname, isAbsolute, join } from "node:path";
import { parseAgentFile } from "../agents/agent.frontmatter.ts";
import { sha256 } from "../storage/json.file.ts";
import type { PolicyEnv, PolicyFs, PolicySnapshot } from "./policy.types.ts";

// §3 row step 3 (shadow check), on the hook fast path.
const ownValue = <T>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

/** Parent dirs walked from cwd looking for project `.claude/agents` dirs. */
const WALK_UP_MAX = 32;
/** Subfolder depth scanned under `.claude/agents` (Claude Code scans it recursively). */
const SHADOW_DEPTH_MAX = 4;
/** More entries than this under one agents dir → treat every role as shadowed rather than read them all. */
const SHADOW_SCAN_MAX = 200;
export const absDir = (v: unknown): string | undefined => (typeof v === "string" && isAbsolute(v) ? v : undefined);

/** Project roots for the shadow check and edit scope: snapshot projectDir, CLAUDE_PROJECT_DIR, cwd (§3). */
const roots = (snap: PolicySnapshot, env: PolicyEnv, cwd: string | undefined) =>
  [...new Set([absDir(snap.projectDir), absDir(env.CLAUDE_PROJECT_DIR), cwd].filter((d): d is string => !!d))];

/** Every `.claude/agents` dir Claude Code may load project agents from: each root, and each dir from cwd up to a root or
 * git root (it walks up from cwd, docs: sub-agents "Project subagents"). HOME is left out (user scope, not project). */
function agentDirs(snap: PolicySnapshot, env: PolicyEnv, cwd: string | undefined, fs: PolicyFs): string[] {
  const rs = roots(snap, env, cwd);
  const dirs = new Set(rs);
  for (let d = cwd, i = 0; d && i < WALK_UP_MAX && d !== env.HOME && dirname(d) !== d; d = dirname(d), i++) {
    dirs.add(d);
    if ((d !== cwd && rs.includes(d)) || fs.lexists(join(d, ".git"))) break;
  }
  return [...dirs].map((d) => join(d, ".claude", "agents"));
}

/** `.md` files under `dir`, recursively (Claude Code scans subfolders); null when there are too many to read. */
function agentFiles(dir: string, fs: PolicyFs): string[] | null {
  const out: string[] = [];
  const queue: [string, number][] = [[dir, 0]];
  let seen = 0;
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [d, depth] = next;
    for (const name of fs.listDir(d) ?? []) {
      if (++seen > SHADOW_SCAN_MAX) return null;
      const path = join(d, name);
      if (name.toLowerCase().endsWith(".md")) out.push(path);
      else if (depth < SHADOW_DEPTH_MAX) queue.push([path, depth + 1]); // listDir on a file is null (ENOTDIR)
    }
  }
  return out;
}

/** §3 row step 3: an unowned project agent file whose stem or frontmatter `name` is this role. */
export function isShadowed(name: string, snap: PolicySnapshot, fs: PolicyFs, env: PolicyEnv, cwd: string | undefined): boolean {
  for (const dir of agentDirs(snap, env, cwd, fs)) {
    const files = agentFiles(dir, fs);
    if (files === null) return true;
    for (const file of files) {
      const stem = basename(file).slice(0, -".md".length) === name;
      const text = fs.readText(file);
      if (text === null) {
        if (stem && fs.lexists(file)) return true;
        continue;
      }
      if (!stem && parseAgentFile(text).meta.name !== name) continue;
      if (ownValue(snap.owned, file) !== sha256(text)) return true;
    }
  }
  return false;
}
