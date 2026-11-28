import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { bashCap, isOwnerOnly, isUncertain, SECRET_CMD_RE, unquote } from "./policy.bash.ts";
import { escalate } from "./policy.escalate.ts";
import { absDir, isShadowed } from "./policy.shadow.ts";
import { isCellAllowed, isDecision, MAIN_ROW, OWNER_ONLY_TOKENS, RESERVED_ROWS, UNKNOWN_ROW } from "./policy.presets.ts";
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
  if (s.escalate !== undefined && typeof s.escalate !== "boolean") throw new Error("policy snapshot: bad escalate");
  return { ...s, escalate: s.escalate === true } as unknown as PolicySnapshot;
}

/** §3 row selection: agent_type regex. */
const AGENT_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const TOOL_CAP: Record<string, Capability> = {
  Read: "read", Grep: "read", Glob: "read", LSP: "read", Edit: "edit", Write: "edit", NotebookEdit: "edit",
  WebFetch: "web", WebSearch: "web", Agent: "agents", SendMessage: "agents", TaskStop: "agents",
};
const MCP_PREFIX = "mcp__";
/** Never "project" for edit: git internals, Claude Code config, and direnv's `.envrc` (it runs on cd). */
const PROTECTED_NAMES = [".git", ".claude", ".envrc"];
const PATH_FIELDS = ["file_path", "notebook_path", "path"];
const SECRET_BASE_RE = /^\.env(?:\..*)?$|^\.envrc$|\.(?:pem|key|p12|pfx)$|^id_(?:rsa|dsa|ecdsa|ed25519)|^credentials\.json$|^service-account\.json$/;
/** A `..` path segment: the kernel resolves a symlink before it, `path.resolve` collapses it first (§3 step 3). */
const DOTDOT_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

function isSecretPath(p: string): boolean {
  const parts = p.toLowerCase().split(/[\\/]+/);
  return parts.some((s) => s === ".ssh" || s === ".aws") || SECRET_BASE_RE.test(parts.at(-1) ?? "");
}

/**
 * Applies each `..` to the realpath of the prefix before it, as the kernel does (`lnk/..` = parent of lnk's target).
 * Needed because `path.resolve` and Bun's realpathSync both collapse `..` lexically first. Null when a prefix is missing.
 */
function kernelDotDot(abs: string, fs: PolicyFs): string | null {
  let acc: string = sep;
  for (const seg of abs.split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg !== "..") acc = join(acc, seg);
    else {
      const real = fs.realpath(acc);
      if (real === null) return null;
      acc = dirname(real);
    }
  }
  return acc;
}

/** Symlink-free absolute path, walking up to the nearest existing ancestor; null for a dangling link or no existing ancestor. */
function canonical(path: string, fs: PolicyFs): string | null {
  const abs = DOTDOT_RE.test(path) ? kernelDotDot(path, fs) : path;
  if (abs === null) return null;
  const tail: string[] = [];
  for (let p = abs; ; p = dirname(p)) {
    const real = fs.realpath(p);
    if (real !== null) return join(real, ...tail);
    if (fs.lexists(p) || dirname(p) === p) return null; // a dangling link's target can't be checked
    tail.unshift(basename(p));
  }
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

/** Inside the scope root; for `edit` also not under a protected name. The root itself counts for `read` (Grep in cwd). */
function insideProject(target: string | null, root: string | null, cap: Capability): boolean {
  if (!target || !root) return false;
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  if (cap === "read") return true;
  return !!rel && !rel.toLowerCase().split(sep).some((s) => PROTECTED_NAMES.includes(s));
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
 * PreToolUse decision for one hook input (§3), first match wins, then worker escalation (v0.4.1). No I/O except through
 * `fs`. `default` = no hook output. `reason` names row and capability only; it never echoes the input.
 */
export const decide = (input: HookInput, snapshot: PolicySnapshot, fs: PolicyFs, env: PolicyEnv = {}): PolicyResult =>
  escalate(decideCell(input, snapshot, fs, env), snapshot);

function decideCell(input: HookInput, snapshot: PolicySnapshot, fs: PolicyFs, env: PolicyEnv): PolicyResult {
  const cwd = absDir(input.cwd);
  const { row, shadowed } = selectRow(input, snapshot, fs, env, cwd);
  const out = (decision: Decision, cap: Capability | null, rule: string, reason = ""): PolicyResult =>
    ({ decision, row, cap, rule, reason: decision === "default" ? "" : reason });
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const ti = isRecord(input.tool_input) ? input.tool_input : {};
  const cmd = tool === "Bash" && typeof ti.command === "string" ? ti.command : null;
  const base = cwd ?? scopeRoot(snapshot, env, cwd, fs) ?? undefined;
  const paths = PATH_FIELDS.map((k) => ti[k]).filter((p): p is string => typeof p === "string" && p.length > 0 && !p.includes("\0"));
  // Joined, not `resolve`d: `canonical` applies `..` after symlinks, as the kernel does.
  const resolved = paths.map((p) => (isAbsolute(p) ? canonical(p, fs) : base ? canonical(`${base}${sep}${p}`, fs) : null));

  // 1. Secret floor. Main is covered by the settings deny rules, so the hook stays out of its way.
  const secret = cmd !== null ? SECRET_CMD_RE.test(unquote(cmd).toLowerCase()) : [...paths, ...resolved].some((p) => p && isSecretPath(p));
  if (secret) return row === MAIN_ROW ? out("default", null, "secret") : out("deny", null, "secret", SECRET_REASON);

  // 2. Owner-only floor: ask, or deny when the row's push cell says deny. Never allow.
  const tokens = new Set([...OWNER_ONLY_TOKENS, ...snapshot.ownerOnly.map((t) => t.toLowerCase())]);
  if (cmd !== null && isOwnerOnly(cmd, tokens)) {
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
  // Grep/Glob without a path search cwd.
  const target = resolved[0] ?? (cap === "read" && !paths.length && cwd ? canonical(cwd, fs) : null);
  // §3 step 3 says "treat the cell as default" outside the project. Safer reading: drop only `allow`, keep ask/deny,
  // so a reviewer's `edit: deny` still denies outside the project instead of loosening to the normal flow.
  // `read` is scoped too (§2.4: it only matters inside), else read allow would auto-approve ~/.npmrc or ~/.netrc.
  // Any `..` segment drops allow: lexical and kernel resolution disagree after a symlink (`lnk/../.zshrc`).
  const scoped = cap === "edit" || cap === "read";
  if (scoped && decision === "allow" && (paths.some((p) => DOTDOT_RE.test(p)) || !insideProject(target, scopeRoot(snapshot, env, cwd, fs), cap))) {
    decision = "default";
    rule = "outside-project";
  }
  // Text the owner-only and secret floors can't read literally (`git pu$(true)sh`, `cat .en?`) never reaches allow.
  if (cmd !== null && decision === "allow" && isUncertain(cmd, tokens)) {
    decision = "ask";
    rule = "owner-check-uncertain";
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
