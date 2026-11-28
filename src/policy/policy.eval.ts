import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseAgentFile } from "../agents/agent.frontmatter.ts";
import { sha256 } from "../storage/json.file.ts";
import {
  isCellAllowed, isDecision, MAIN_ROW, OWNER_ONLY_TOKENS, RESERVED_ROWS, SHELL_META_RE, TEST_COMMAND_MAX_CHARS, UNKNOWN_ROW,
} from "./policy.presets.ts";
import type { Capability, Decision, HookInput, PolicyEnv, PolicyFs, PolicyResult, PolicySnapshot } from "./policy.types.ts";

// Hook fast path (§3): imports stay minimal (no roles registry, config store or role prompts).
/** `map[key]` only for an own property, so "__proto__"/"constructor" never resolve to Object.prototype. */
const ownValue = <T>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** Parses policy.compiled.json text; throws with the failing field so the hook can fail open (§3). */
export function parseSnapshot(text: string): PolicySnapshot {
  const s: unknown = JSON.parse(text);
  if (!isRecord(s) || s.version !== 1) throw new Error("policy snapshot: unsupported version");
  if (!isRecord(s.matrix) || !Object.values(s.matrix).every(isRecord)) throw new Error("policy snapshot: bad matrix");
  if (!isStrings(s.testCommands) || !isStrings(s.ownerOnly)) throw new Error("policy snapshot: bad testCommands/ownerOnly");
  if (!isRecord(s.owned) || !Object.values(s.owned).every((v) => typeof v === "string")) throw new Error("policy snapshot: bad owned");
  if (s.projectDir !== undefined && typeof s.projectDir !== "string") throw new Error("policy snapshot: bad projectDir");
  return s as unknown as PolicySnapshot;
}

/** §3 row selection: agent_type regex. */
const AGENT_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** More files than this in one agents dir → treat every role as shadowed rather than read them all. */
const SHADOW_SCAN_MAX = 200;
const TOOL_CAP: Record<string, Capability> = {
  Read: "read", Grep: "read", Glob: "read", LSP: "read", Edit: "edit", Write: "edit", NotebookEdit: "edit",
  WebFetch: "web", WebSearch: "web", Agent: "agents", SendMessage: "agents", TaskStop: "agents",
};
const MCP_PREFIX = "mcp__";
const GIT_LOCAL = ["add", "commit", "switch", "checkout", "restore", "stash", "branch"];
const PROTECTED_DIRS = [".git", ".claude"];
const PATH_FIELDS = ["file_path", "notebook_path", "path"];
// ponytail: text heuristics (§10), not a sandbox; `.env` also hits `process.env` (false deny, never a false allow).
const SECRET_CMD_RE = /\.env\b|id_(?:rsa|dsa|ecdsa|ed25519)|\.(?:pem|key|p12|pfx)\b|\.ssh\b|\.aws\b|credentials\.json|service-account\.json/;
const SECRET_BASE_RE = /^\.env(?:\..*)?$|\.(?:pem|key|p12|pfx)$|^id_(?:rsa|dsa|ecdsa|ed25519)|^credentials\.json$|^service-account\.json$/;
const WORD_SPLIT_RE = /[\s;&|()<>$`{}=,:/]+/;
const RECURSIVE_FLAG_RE = /^-[a-z]*r/;

/** Quotes and backslashes removed, so `.e""nv`, `.\env` and `"git" push` read as the shell would. */
const unquote = (cmd: string) => cmd.replace(/[\\'"]/g, "");

function isSecretPath(p: string): boolean {
  const parts = p.toLowerCase().split(/[\\/]+/);
  return parts.some((s) => s === ".ssh" || s === ".aws") || SECRET_BASE_RE.test(parts.at(-1) ?? "");
}

/** §3 step 2: an owner-only word anywhere (stricter than "after git/npm/…"), or `rm` with a recursive flag. */
function isOwnerOnly(cmd: string, tokens: Set<string>): boolean {
  const words = unquote(cmd).toLowerCase().split(WORD_SPLIT_RE).filter(Boolean);
  if (words.some((w) => tokens.has(w))) return true;
  return words.includes("rm") && words.some((w) => w === "--recursive" || RECURSIVE_FLAG_RE.test(w));
}

/** §3 step 4: simple = no metacharacter (or stray quote) left after dropping single-quoted spans. */
const isSimple = (cmd: string) => {
  const rest = cmd.replace(/'[^']*'/g, "");
  return !SHELL_META_RE.test(rest) && !rest.includes("'");
};
const squash = (s: string) => s.trim().split(/\s+/).join(" ");

function bashCap(cmd: string, testCommands: string[]): { cap: Capability; compound: boolean } {
  if (!isSimple(cmd)) return { cap: "shell", compound: true };
  const words = squash(cmd).split(" ");
  const line = words.join(" ");
  const tests = testCommands.filter((t) => t.trim() && t.length <= TEST_COMMAND_MAX_CHARS && isSimple(t) && !t.includes("'")).map(squash);
  if (tests.some((t) => line === t || line.startsWith(`${t} `))) return { cap: "test", compound: false };
  if (words[0] === "git" && GIT_LOCAL.includes(words[1] ?? "")) return { cap: "git", compound: false };
  return { cap: "shell", compound: false };
}

/** Symlink-free absolute path, walking up to the nearest existing ancestor; null for a dangling link or no existing ancestor. */
function canonical(abs: string, fs: PolicyFs): string | null {
  const tail: string[] = [];
  for (let p = abs; ; p = dirname(p)) {
    const real = fs.realpath(p);
    if (real !== null) return join(real, ...tail);
    if (fs.lexists(p) || dirname(p) === p) return null; // a dangling link's target can't be checked
    tail.unshift(basename(p));
  }
}

const absDir = (v: unknown): string | undefined => (typeof v === "string" && isAbsolute(v) ? v : undefined);

/** Project roots for the shadow check and edit scope: snapshot projectDir, CLAUDE_PROJECT_DIR, cwd (§3). */
const roots = (snap: PolicySnapshot, env: PolicyEnv, cwd: string | undefined) =>
  [...new Set([absDir(snap.projectDir), absDir(env.CLAUDE_PROJECT_DIR), cwd].filter((d): d is string => !!d))];

/** §3 row step 3: an unowned project agent file whose stem or frontmatter `name` is this role. */
function isShadowed(name: string, snap: PolicySnapshot, fs: PolicyFs, env: PolicyEnv, cwd: string | undefined): boolean {
  for (const root of roots(snap, env, cwd)) {
    const dir = join(root, ".claude", "agents");
    const files = (fs.listDir(dir) ?? []).filter((f) => f.toLowerCase().endsWith(".md"));
    if (files.length > SHADOW_SCAN_MAX) return true;
    for (const f of files) {
      const file = join(dir, f);
      const stem = f.slice(0, -".md".length) === name;
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

function selectRow(input: HookInput, snap: PolicySnapshot, fs: PolicyFs, env: PolicyEnv, cwd: string | undefined) {
  if (input.agent_id === undefined || input.agent_id === null) return { row: MAIN_ROW, shadowed: false };
  const name = input.agent_type;
  const valid = typeof name === "string" && AGENT_NAME_RE.test(name) && !name.includes("..") && !Object.hasOwn(Object.prototype, name);
  if (!valid || RESERVED_ROWS.includes(name) || !Object.hasOwn(snap.matrix, name)) return { row: UNKNOWN_ROW, shadowed: false };
  return isShadowed(name, snap, fs, env, cwd) ? { row: UNKNOWN_ROW, shadowed: true } : { row: name, shadowed: false };
}

/** Edit scope root; null when it can't be resolved or is `/` or HOME (that would make every dotfile "project"). */
function scopeRoot(snap: PolicySnapshot, env: PolicyEnv, cwd: string | undefined, fs: PolicyFs): string | null {
  const raw = absDir(snap.projectDir) ?? absDir(env.CLAUDE_PROJECT_DIR) ?? cwd;
  const root = raw ? fs.realpath(raw) : null;
  if (!root || dirname(root) === root) return null;
  const home = absDir(env.HOME) ? fs.realpath(env.HOME!) : null;
  return root === home ? null : root;
}

function insideProject(target: string | null, root: string | null): boolean {
  if (!target || !root) return false;
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  return !rel.toLowerCase().split(sep).some((s) => PROTECTED_DIRS.includes(s));
}

const cellOf = (snap: PolicySnapshot, row: string, cap: Capability): Decision => {
  const cells = ownValue(snap.matrix, row) as Record<string, unknown> | undefined;
  const d = cells && typeof cells === "object" ? ownValue(cells, cap) : undefined;
  return isDecision(d) && isCellAllowed(cap, d) ? d : d === "allow" ? "ask" : "default";
};

const VERB: Record<Decision, string> = { allow: "may use", ask: "must ask the owner for", deny: "may not use", default: "" };
const SECRET_REASON = "claude-manager policy: secrets (.env, keys, credentials) stay with the owner.";
const OWNER_REASON = "claude-manager policy: push, publish, deploy, release and rm -r are owner-only; the owner decides.";

/**
 * PreToolUse decision for one hook input (§3), first match wins. No I/O except through `fs`.
 * `default` = no hook output. `reason` names row and capability only; it never echoes the input.
 */
export function decide(input: HookInput, snapshot: PolicySnapshot, fs: PolicyFs, env: PolicyEnv = {}): PolicyResult {
  const cwd = absDir(input.cwd);
  const { row, shadowed } = selectRow(input, snapshot, fs, env, cwd);
  const out = (decision: Decision, cap: Capability | null, rule: string, reason = ""): PolicyResult =>
    ({ decision, row, cap, rule, reason: decision === "default" ? "" : reason });
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const ti = isRecord(input.tool_input) ? input.tool_input : {};
  const cmd = tool === "Bash" && typeof ti.command === "string" ? ti.command : null;
  const base = cwd ?? scopeRoot(snapshot, env, cwd, fs) ?? undefined;
  const paths = PATH_FIELDS.map((k) => ti[k]).filter((p): p is string => typeof p === "string" && p.length > 0 && !p.includes("\0"));
  const resolved = paths.map((p) => (base || isAbsolute(p) ? canonical(resolve(base ?? "/", p), fs) : null));

  // 1. Secret floor. Main is covered by the settings deny rules, so the hook stays out of its way.
  const secret = cmd !== null ? SECRET_CMD_RE.test(unquote(cmd).toLowerCase()) : [...paths, ...resolved].some((p) => p && isSecretPath(p));
  if (secret) return row === MAIN_ROW ? out("default", null, "secret") : out("deny", null, "secret", SECRET_REASON);

  // 2. Owner-only floor: ask, or deny when the row's push cell says deny. Never allow.
  if (cmd !== null && isOwnerOnly(cmd, new Set([...OWNER_ONLY_TOKENS, ...snapshot.ownerOnly.map((t) => t.toLowerCase())]))) {
    return out(cellOf(snapshot, row, "push") === "deny" ? "deny" : "ask", "push", "owner-only:push", OWNER_REASON);
  }

  // 3-4. Capability; Bash compound commands fall to `shell`.
  let cap: Capability | undefined = Object.hasOwn(TOOL_CAP, tool) ? TOOL_CAP[tool] : tool.startsWith(MCP_PREFIX) ? "mcp" : undefined;
  let compound = false;
  if (tool === "Bash") ({ cap, compound } = bashCap(cmd ?? "", snapshot.testCommands));
  if (!cap) return out("default", null, "unknown-tool");

  // 5. Cell value.
  let decision = cellOf(snapshot, row, cap);
  let rule = shadowed ? "shadowed" : compound ? "compound-shell" : `role:${row}.${cap}`;
  const target = resolved[0] ?? null;
  // §3 step 3 says "treat the cell as default" outside the project. Safer reading: drop only `allow`, keep ask/deny,
  // so a reviewer's `edit: deny` still denies outside the project instead of loosening to the normal flow.
  if (cap === "edit" && decision === "allow" && !insideProject(target, scopeRoot(snapshot, env, cwd, fs))) {
    decision = "default";
    rule = "outside-project";
  }
  return out(decision, cap, rule, `claude-manager policy: ${row} ${VERB[decision]} ${cap} (${rule}). Change it: claude-manager policy set ${row} ${cap} <allow|ask|deny|default>`);
}

/** ENOENT-like errors mean "not there"; anything else is rethrown with the operation and path. */
const ABSENT = new Set(["ENOENT", "ENOTDIR", "ELOOP", "EISDIR"]);
function orNull<T>(op: string, path: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    if (ABSENT.has((err as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error(`policy ${op} ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Real `PolicyFs` for the hook (sync: one small call per check). */
export const nodePolicyFs: PolicyFs = {
  realpath: (p) => orNull("realpath", p, () => realpathSync.native(p)),
  lexists: (p) => orNull("lstat", p, () => lstatSync(p)) !== null,
  readText: (p) => orNull("read", p, () => readFileSync(p, "utf8")),
  listDir: (p) => orNull("readdir", p, () => readdirSync(p)),
};
