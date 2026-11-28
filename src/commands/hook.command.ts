import { closeSync, constants, fstatSync, openSync, readFileSync, writeSync } from "node:fs";
import { CliError } from "../cli.error.ts";
import { policyAuditFilePath, policySnapshotPath } from "../policy/policy.paths.ts";
import { decide, nodePolicyFs, parseSnapshot } from "../policy/policy.eval.ts";
import type { HookInput, PolicyResult } from "../policy/policy.types.ts";

/** Stdin larger than this is rejected (fail-open), spec §3. */
export const HOOK_STDIN_MAX_BYTES = 1024 * 1024;
/** The hook stops appending past this size; `sync` has not ingested/rotated the file (spec §2.7). */
export const HOOK_AUDIT_MAX_BYTES = 20 * 1024 * 1024;
const AUDIT_FILE_MODE = 0o600;
const FIELD_MAX = 64; // keeps every audit line far below PIPE_BUF so one write() is atomic
const SAFE_RE = /^[A-Za-z0-9_.:-]+$/;

type Stage = "stdin" | "parse" | "snapshot" | "decide";

/** The only fields ever written to the audit file: never tool input, paths, commands, cwd or prompts. */
interface AuditLine {
  ts: string;
  session_id: string | null;
  agent_id: string | null;
  role: string;
  tool: string;
  cap: string | null;
  decision: string;
  rule: string;
  mode: string | null;
}

/** Value if it is a short identifier-like string, else null (untrusted input never reaches the audit as-is). */
const safe = (v: unknown): string | null => (typeof v === "string" && v.length <= FIELD_MAX && SAFE_RE.test(v) ? v : null);

/** MCP tool names are cut to `mcp__<server>` (spec §2.7). */
function auditTool(v: unknown): string {
  const t = typeof v === "string" ? v : "";
  const name = t.startsWith("mcp__") ? t.split("__").slice(0, 2).join("__") : t;
  return safe(name) ?? "-";
}

function auditLine(input: HookInput, r: Pick<PolicyResult, "row" | "cap" | "rule"> & { decision: string }): AuditLine {
  return {
    ts: new Date().toISOString(),
    session_id: safe(input.session_id),
    agent_id: safe(input.agent_id),
    role: r.row,
    tool: auditTool(input.tool_name),
    cap: r.cap,
    decision: r.decision,
    rule: r.rule,
    mode: safe(input.permission_mode),
  };
}

/** One O_APPEND write per line. Returns an error message for stderr instead of throwing: audit I/O never changes the decision. */
function appendAudit(line: AuditLine): string | null {
  const path = policyAuditFilePath();
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, AUDIT_FILE_MODE);
    try {
      if (fstatSync(fd).size <= HOOK_AUDIT_MAX_BYTES) writeSync(fd, `${JSON.stringify(line)}\n`);
    } finally {
      closeSync(fd);
    }
    return null;
  } catch (err) {
    return `audit append failed (${(err as NodeJS.ErrnoException).code ?? (err as Error).name})`;
  }
}

/** Reads at most cap+1 bytes of stdin and throws when the input is over the cap. */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = Bun.stdin.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > HOOK_STDIN_MAX_BYTES) throw new Error(`stdin exceeds ${HOOK_STDIN_MAX_BYTES} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined); // already closed or discarded: nothing left to release
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Exact PreToolUse output (code.claude.com/docs/en/hooks); empty string = no decision. */
function render(r: PolicyResult): string {
  if (r.decision === "default") return "";
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: r.decision, permissionDecisionReason: r.reason },
  });
}

/**
 * `claude-manager hook pre-tool-use`: stdin JSON -> stdout decision JSON. Always returns 0 (fail-open, spec §11.5):
 * any error yields empty output plus an `error` audit line, so Claude Code falls back to its normal permission flow.
 */
export async function runPreToolUse(): Promise<number> {
  let input: HookInput = {};
  let stage: Stage = "stdin";
  let out = "";
  let audit: AuditLine | null = null;
  try {
    const raw = await readStdin();
    stage = "parse";
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("stdin is not a JSON object");
    input = parsed as HookInput;
    stage = "snapshot";
    const snapshot = parseSnapshot(readFileSync(policySnapshotPath(), "utf8"));
    stage = "decide";
    const result = decide(input, snapshot, nodePolicyFs, { CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR, HOME: process.env.HOME });
    out = render(result);
    if (result.decision !== "default") audit = auditLine(input, result);
  } catch (err) {
    out = "";
    // Name and stage only: JSON.parse messages can quote the input.
    process.stderr.write(`claude-manager hook: ${stage} failed (${(err as NodeJS.ErrnoException).code ?? (err as Error).name}); using normal permissions\n`);
    audit = auditLine(input, { decision: "error", row: "unknown", cap: null, rule: `hook-error:${stage}` });
  }
  if (audit) {
    const failure = appendAudit(audit);
    if (failure) process.stderr.write(`claude-manager hook: ${failure}\n`);
  }
  process.stdout.write(out);
  return 0;
}

/** Entry for `claude-manager hook <event>`; only `pre-tool-use` exists. */
export function runHook(args: string[]): Promise<number> {
  if (args[0] !== "pre-tool-use") throw new CliError(`unknown hook event "${args[0] ?? ""}". Supported: pre-tool-use.`);
  return runPreToolUse();
}
