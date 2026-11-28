import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeDir } from "../app.paths.ts";
import type { Config } from "../config/config.store.ts";
import type { PolicyRecord } from "../install/install.manifest.ts";
import { parseSettings, readText } from "../install/install.target.ts";
import { getKey } from "../install/settings.merge.ts";
import { effectivePolicy, matrixOf } from "../policy/policy.effective.ts";
import { parseSnapshot } from "../policy/policy.eval.ts";
import type { Capability, PolicyConfig, PolicyMatrix } from "../policy/policy.types.ts";
import type { RoutingCheck } from "./doctor.routing.ts";

type Settings = Record<string, unknown>;
type Hook = { command?: string; args?: string[] };

/** Managed settings locations per spec §1.3; unverified, so a hit is only ever a soft warning unless it blocks hooks/rules. */
export const MANAGED_PATHS = [
  "/Library/Application Support/ClaudeCode/managed-settings.json",
  "/etc/claude-code/managed-settings.json",
  "C:\\Program Files\\ClaudeCode\\managed-settings.json",
];

/** Bare or full-wildcard deny on these tools blocks the capabilities (§7; `Tool(path)` rules are ignored). */
const TOOL_CAPS: Record<string, Capability[]> = {
  Read: ["read"], Grep: ["read"], Glob: ["read"], Edit: ["edit"], Write: ["edit"], NotebookEdit: ["edit"],
  Bash: ["test", "shell", "git"], WebFetch: ["web"], WebSearch: ["web"], Agent: ["agents"],
};
const MANAGED_BLOCKERS = ["allowManagedHooksOnly", "allowManagedPermissionRulesOnly", "disableAllHooks"];
const APPLY_FIX = 'Run "claude-manager policy apply balanced"';

type Loaded = { path: string; settings?: Settings; error?: string };

async function load(path: string): Promise<Loaded> {
  try {
    return { path, settings: parseSettings(await readText(path), path) };
  } catch (err) {
    return { path, error: (err as Error).message };
  }
}

const isOurHook = (h: Hook) => h?.args?.slice(-2).join(" ") === "hook pre-tool-use";
const hooksOf = (g: unknown) => ((g as { hooks?: Hook[] })?.hooks ?? []).filter(Boolean);

function checkHook(rec: PolicyRecord, settings: Settings, execPath: string): RoutingCheck {
  const groups = (getKey(settings, "hooks.PreToolUse") as unknown[] | undefined) ?? [];
  const exact = rec.hook ? groups.find((g) => Bun.deepEquals(g, rec.hook!.group)) : undefined;
  const found = exact ?? groups.find((g) => hooksOf(g).some(isOurHook));
  const fix = `${APPLY_FIX} to restore it`;
  if (!found) return { ok: false, label: `policy hook missing from ${rec.settingsPath}: workers will prompt for every tool. ${fix}` };
  if (rec.hook && !exact) return { ok: false, label: `policy hook in ${rec.settingsPath} was edited (command, args or matcher changed). ${fix}` };
  const hook = hooksOf(found).find(isOurHook)!;
  const bin = hook.command ?? "";
  const src = hook.args?.[0];
  const missing = [bin, ...(src && src !== "hook" ? [src] : [])].find((p) => !existsSync(p));
  if (missing) return { ok: false, label: `policy hook points at ${missing}, which no longer exists (binary moved?). ${fix}` };
  if (!(statSync(bin).mode & 0o111)) return { ok: false, label: `policy hook binary ${bin} is not executable. ${fix}` };
  if (bin !== execPath) {
    return { ok: "warn", label: `policy hook runs ${bin}, not this binary (${execPath}). Fine if intended, otherwise ${APPLY_FIX.toLowerCase()}` };
  }
  return { ok: true, label: "policy hook installed and runnable" };
}

async function checkSnapshot(rec: PolicyRecord, config: Config): Promise<{ check: RoutingCheck; matrix?: PolicyMatrix }> {
  const fix = `${APPLY_FIX} to regenerate it`;
  const raw = await readText(rec.compiledPath);
  if (raw === undefined) return { check: { ok: false, label: `policy snapshot ${rec.compiledPath} is missing: the hook cannot decide anything. ${fix}` } };
  try {
    const snap = parseSnapshot(raw);
    const current = matrixOf(effectivePolicy(config as Config & { policy?: PolicyConfig }));
    if (!Bun.deepEquals(snap.matrix, current)) {
      return { check: { ok: false, label: `policy snapshot is stale: config.json changed since it was compiled. ${fix}` }, matrix: current };
    }
    return { check: { ok: true, label: "policy snapshot is current" }, matrix: current };
  } catch (err) {
    return { check: { ok: false, label: `policy snapshot ${rec.compiledPath} is invalid (${(err as Error).message}). ${fix}` } };
  }
}

function checkEntries(rec: PolicyRecord, settings: Settings): RoutingCheck[] {
  const gone = rec.entries.filter((e) => !((getKey(settings, e.list) as unknown[] | undefined) ?? []).includes(e.value));
  if (!gone.length) return [];
  return [{ ok: "warn", label: `${gone.length} policy rule(s) were removed from ${rec.settingsPath} by hand (e.g. ${gone[0]!.list} ${gone[0]!.value}). ${APPLY_FIX} to restore` }];
}

function checkModes(files: Loaded[]): RoutingCheck[] {
  const out: RoutingCheck[] = [];
  for (const { path, settings } of files) {
    const mode = settings && getKey(settings, "permissions.defaultMode");
    if (mode === "bypassPermissions") {
      out.push({ ok: "warn", label: `${path} sets defaultMode bypassPermissions: owner-only ask rules (push, publish) may be skipped. Remove it or switch to acceptEdits` });
    } else if (mode === "acceptEdits" || mode === "auto") {
      out.push({ ok: true, label: `${path} sets defaultMode ${mode}: subagent permissionMode is ignored, the policy hook still applies` });
    }
  }
  return out;
}

// ponytail: bare and full-wildcard deny rules only; scoped rules like Edit(src/**) are not compared
function checkConflicts(files: Loaded[], matrix: PolicyMatrix): RoutingCheck[] {
  const out: RoutingCheck[] = [];
  for (const { path, settings } of files) {
    const deny = ((settings && getKey(settings, "permissions.deny")) as unknown[] | undefined) ?? [];
    for (const rule of deny) {
      const tool = typeof rule === "string" ? /^([A-Za-z]+)(\(\*{1,2}\))?$/.exec(rule)?.[1] : undefined;
      const caps = tool ? TOOL_CAPS[tool] : undefined;
      if (!tool || !caps) continue;
      const hits = Object.entries(matrix).flatMap(([row, cells]) => caps.filter((c) => cells[c] === "allow").map((c) => `${row}.${c}`));
      if (hits.length) out.push({ ok: "warn", label: `${hits.join(", ")} allow has no effect: ${path} denies ${tool}. Remove that deny rule or set the cell to default` });
    }
  }
  return out;
}

async function checkManaged(paths: string[]): Promise<RoutingCheck[]> {
  const out: RoutingCheck[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const { settings, error } = await load(path);
    const blocks = settings ? MANAGED_BLOCKERS.filter((k) => settings[k] === true) : [];
    out.push(blocks.length
      ? { ok: false, label: `managed settings ${path} set ${blocks.join(", ")}: the policy hook or rules may be overridden. Ask your admin to allow user hooks` }
      : { ok: "warn", label: `managed settings ${path} exist${error ? ` (unreadable: ${error})` : ""} and may override the policy; check with your admin` });
  }
  return out;
}

/** Doctor section for the permission policy; without an applied policy it is exactly one line. */
export async function checkPolicy(
  config: Config,
  rec: PolicyRecord | undefined,
  opts: { cwd?: string; managed?: string[]; execPath?: string } = {},
): Promise<RoutingCheck[]> {
  if (!rec) return [{ ok: "warn", label: `no permission policy: workers will prompt you for every tool. ${APPLY_FIX}` }];
  const cwd = opts.cwd ?? process.cwd();
  const paths = [...new Set([rec.settingsPath, join(claudeDir(), "settings.json"), join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")])];
  const files = await Promise.all(paths.map(load));
  const own = files[0]!;
  const out: RoutingCheck[] = own.settings
    ? [checkHook(rec, own.settings, opts.execPath ?? process.execPath), ...checkEntries(rec, own.settings)]
    : [{ ok: false, label: `${own.error}. Fix the file, then ${APPLY_FIX.toLowerCase()}` }];
  const snap = await checkSnapshot(rec, config);
  out.push(snap.check, ...checkModes(files), ...(snap.matrix ? checkConflicts(files, snap.matrix) : []));
  out.push(...(await checkManaged(opts.managed ?? MANAGED_PATHS)));
  return out;
}
