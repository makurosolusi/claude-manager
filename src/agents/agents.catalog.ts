import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { claudeDir } from "../app.paths.ts";
import { CliError } from "../cli.error.ts";
import { configPath, type Config, type Tier, TIER_ALIAS } from "../config/config.store.ts";
import { loadManifest, type InstallRecord } from "../install/install.manifest.ts";
import { readText } from "../install/install.target.ts";
import { allRoles, BUILTIN_AGENTS } from "../roles/roles.registry.ts";
import { KNOWN_TOOLS } from "../roles/roles.presets.ts";
import { sha256 } from "../storage/json.file.ts";
import type {
  AgentDetail, AgentRow, AgentScope, AgentsResponse, AgentUsage, ExternalSource,
} from "../server/agents.types.ts";
import { parseAgentFile } from "./agent.frontmatter.ts";

/** Cap on rows returned by the list; the table paginates client-side. */
export const MAX_AGENTS = 500;
const MAX_FILE_BYTES = 256 * 1024;
const PIN_ALIASES: string[] = Object.values(TIER_ALIAS);

/** One row of `agentUsage(db, since)` (src/db/agents.repository.ts); `rerouted` is null when the column does not exist. */
export interface UsageRow {
  role: string;
  requests: number;
  cost_usd: number;
  unpriced: number;
  last_ts: string | null;
  rerouted: number | null;
}

export interface CatalogOptions {
  /** Dashboard working directory; its `.claude/agents` is scanned too. Defaults to `process.cwd()`. */
  cwd?: string;
}

interface Extra {
  prompt: string | null;
  prompt_source: AgentDetail["prompt_source"];
  file_path: string | null;
  warnings: string[];
}

interface Catalog {
  rows: AgentRow[];
  extras: Map<string, Extra>;
  warnings: string[];
  etag: string;
  installed: boolean;
}

interface ExternalFile { path: string; name: string; project: boolean; text: string }

const NO_USAGE: AgentUsage = { requests: 0, cost_usd: 0, unpriced: 0, last_ts: null, rerouted_pct: 0 };

function toUsage(u: UsageRow | undefined): AgentUsage {
  if (!u) return { ...NO_USAGE };
  const pct = u.rerouted === null ? null : u.requests > 0 ? (u.rerouted / u.requests) * 100 : 0;
  return { requests: u.requests, cost_usd: u.cost_usd, unpriced: u.unpriced, last_ts: u.last_ts, rerouted_pct: pct };
}

async function listMd(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw new CliError(`cannot read agents directory ${dir}: ${(err as Error).message}`);
  }
}

interface AgentDir { dir: string; project: boolean }

/** Reads `*.md` files (non-recursive, up to 256 KiB) from the agent dirs, skipping files the manifest owns. */
async function scanExternals(dirs: AgentDir[], owned: Set<string>, warnings: string[]): Promise<ExternalFile[]> {
  const out: ExternalFile[] = [];
  const seen = new Set<string>();
  for (const { dir, project } of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const file of await listMd(dir)) {
      const path = join(dir, file);
      if (owned.has(path)) continue;
      const handle = Bun.file(path);
      if (handle.size > MAX_FILE_BYTES) {
        warnings.push(`${path} skipped: larger than ${MAX_FILE_BYTES / 1024} KiB`);
        continue;
      }
      try {
        out.push({ path, name: file.slice(0, -3), project, text: await handle.text() });
      } catch (err) {
        throw new CliError(`cannot read agent file ${path}: ${(err as Error).message}`);
      }
    }
  }
  return out;
}

/** State per install: missing > shadowed (user copy under a project file) > edited (sha differs) > installed. */
async function scopesFor(name: string, disabled: boolean, installs: InstallRecord[], shadowed: boolean): Promise<AgentScope[]> {
  const scopes: AgentScope[] = [];
  for (const rec of installs) {
    const path = join(rec.agentsDir, `${name}.md`);
    const record = rec.files[path];
    if (disabled && !record) continue; // nothing was written for a disabled role
    const text = await readText(path);
    let state: AgentScope["state"] = "installed";
    if (text === undefined) state = "missing";
    else if (rec.scope === "user" && shadowed) state = "shadowed";
    else if (record && sha256(text) !== record.sha256) state = "edited";
    scopes.push({ scope: rec.scope, path, state });
  }
  return scopes;
}

const empty = (): Omit<AgentRow, "name" | "kind" | "source" | "status" | "usage" | "main_agent"> => ({
  description: null, color: null, tier: null, pin: null, alias: null, model_id: null,
  tools: null, disallowed_tools: null, scopes: [],
});

async function build(config: Config, usage: UsageRow[], opts: CatalogOptions): Promise<Catalog> {
  const cwd = opts.cwd ?? process.cwd();
  const manifest = await loadManifest();
  const installs = Object.values(manifest.installs);
  const configText = await readText(configPath());
  const warnings: string[] = [];
  const usageBy = new Map(usage.map((u) => [u.role, u]));
  const mains = new Set(installs.map((i) => i.mainAgent).filter(Boolean));
  const owned = new Set(installs.flatMap((i) => Object.keys(i.files)));

  const userDir = join(claudeDir(), "agents");
  const cwdDir = join(cwd, ".claude", "agents");
  const dirs: AgentDir[] = [
    { dir: cwdDir, project: cwdDir !== userDir },
    ...installs.map((i) => ({ dir: i.agentsDir, project: i.scope === "project" })),
    { dir: userDir, project: false },
  ].sort((a, b) => Number(b.project) - Number(a.project)); // project first: highest precedence wins per name
  const files = await scanExternals(dirs, owned, warnings);
  const fileBy = new Map<string, { file: ExternalFile; meta: ReturnType<typeof parseAgentFile> }>();
  const shadows = new Map<string, string>();
  for (const file of files) {
    const parsed = parseAgentFile(file.text);
    const name = parsed.meta.name ?? file.name;
    if (!fileBy.has(name)) fileBy.set(name, { file, meta: parsed });
    if (file.project && !shadows.has(name)) shadows.set(name, file.path);
  }

  const rows: AgentRow[] = [];
  const extras = new Map<string, Extra>();
  const row = (r: Omit<AgentRow, "usage" | "main_agent">): AgentRow => ({
    ...r, usage: toUsage(usageBy.get(r.name)), main_agent: mains.has(r.name),
  });

  for (const role of allRoles(config)) {
    const scopes = await scopesFor(role.name, role.disabled, installs, shadows.has(role.name));
    const tierRouted = role.model === undefined;
    const pin = role.model ?? null;
    rows.push(row({
      name: role.name, kind: role.source, source: null, status: role.disabled ? "disabled" : "enabled",
      description: role.description, color: role.color ?? null, tier: role.tier, pin,
      alias: role.model ?? TIER_ALIAS[role.tier],
      model_id: tierRouted ? config.tiers[role.tier] : pin && !PIN_ALIASES.includes(pin) ? pin : null,
      tools: role.tools ?? null, disallowed_tools: role.disallowedTools ?? null, scopes,
    }));
    const fromConfig = role.source === "custom" && Boolean(config.customRoles[role.name]?.prompt);
    const w: string[] = [];
    for (const s of scopes) {
      if (s.state === "edited") w.push(`${s.path} was edited by hand; the next install or role change will report a conflict`);
      if (s.state === "shadowed") w.push(`${shadows.get(role.name)} shadows the ${s.scope} copy (project scope wins)`);
      if (s.state === "missing" && !role.disabled) w.push(`${s.path} is not on disk; run "claude-manager install"`);
    }
    if (role.disabled && mains.has(role.name)) w.push("this agent is disabled but still set as the main agent");
    extras.set(role.name, { prompt: role.prompt, prompt_source: fromConfig ? "config" : "default", file_path: scopes[0]?.path ?? null, warnings: w });
  }

  for (const [name, { file, meta }] of fileBy) {
    if (rows.some((r) => r.name === name)) continue; // managed name: shown via scopes (shadowed), not twice
    const m = meta.meta;
    rows.push(row({
      ...empty(), name, kind: "external", source: "file", status: "enabled",
      description: m.description ?? null, color: m.color ?? null, alias: m.model ?? null,
      tools: m.tools ?? null, disallowed_tools: m.disallowedTools ?? null,
    }));
    extras.set(name, { prompt: meta.body, prompt_source: "file", file_path: file.path, warnings: meta.warning ? [`${file.path}: ${meta.warning}`] : [] });
  }

  const known = new Set(rows.map((r) => r.name));
  const addNamed = (name: string, source: ExternalSource) => {
    if (known.has(name)) return;
    known.add(name);
    rows.push(row({ ...empty(), name, kind: "external", source, status: "enabled" }));
    extras.set(name, { prompt: null, prompt_source: null, file_path: null, warnings: [] });
  };
  for (const name of BUILTIN_AGENTS) addNamed(name, "builtin");
  for (const u of usage) {
    if (u.role !== "main" && u.role !== "subagent") addNamed(u.role, u.role.includes(":") ? "plugin" : "unknown");
  }

  return { rows, extras, warnings, etag: configText === undefined ? "none" : sha256(configText), installed: installs.length > 0 };
}

/** Builds the Agents list from config, manifest, agent dirs and 30-day usage rows (merged by name, capped at MAX_AGENTS). */
export async function buildAgents(config: Config, usage: UsageRow[], opts: CatalogOptions = {}): Promise<AgentsResponse> {
  const c = await build(config, usage, opts);
  const tiers: Record<Tier, string> = config.tiers;
  return {
    items: c.rows.slice(0, MAX_AGENTS), truncated: c.rows.length > MAX_AGENTS, etag: c.etag,
    tiers, known_tools: KNOWN_TOOLS, warnings: c.warnings, installed: c.installed,
  };
}

/** One agent with prompt, source file and per-agent warnings; undefined when the name is unknown. */
export async function buildAgentDetail(
  config: Config, name: string, usage: UsageRow[], opts: CatalogOptions = {},
): Promise<AgentDetail | undefined> {
  const c = await build(config, usage, opts);
  const found = c.rows.find((r) => r.name === name);
  if (!found) return undefined;
  return { ...found, ...c.extras.get(name)!, etag: c.etag };
}
