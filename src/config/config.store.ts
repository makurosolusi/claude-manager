import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../cli.error.ts";
import { appDir } from "../app.paths.ts";
import type { PolicyConfig } from "../policy/policy.types.ts";
import { TIER_ALIAS_MAP } from "../roles/model.ids.ts";
import { writeJson } from "../storage/json.file.ts";

export type Tier = "think" | "work" | "basic";
export const TIERS: Tier[] = ["think", "work", "basic"];

export const TIER_ALIAS: Record<Tier, "opus" | "sonnet" | "haiku"> = TIER_ALIAS_MAP;

export const TIER_ENV: Record<Tier, string> = {
  think: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  work: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  basic: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
};

export const DEFAULT_TIER_MODELS: Record<Tier, string> = {
  think: "claude-opus-5-5",
  work: "claude-sonnet-5-5",
  basic: "claude-haiku-5-5",
};

export interface CustomRole {
  tier: Tier;
  description: string;
  tools?: string[];
  prompt?: string;
}

export interface Config {
  tiers: Record<Tier, string>;
  /** Per-role override: a tier name or a model alias/ID pinned to that role. */
  roleModels: Record<string, string>;
  customRoles: Record<string, CustomRole>;
  disabledRoles: string[];
  /** Keep user prompt text in the local DB (false = metadata only). */
  storePromptText: boolean;
  /** Port for `claude-manager dashboard` (overridden by --port). */
  dashboardPort?: number;
  /** Permission policy (PLAN/08 §2.2); absent = never set up. Validated by policy.service on write. */
  policy?: PolicyConfig;
}

export const configPath = () => join(appDir(), "config.json");

function withDefaults(saved: Partial<Config>): Config {
  return {
    tiers: { ...DEFAULT_TIER_MODELS, ...saved.tiers },
    roleModels: saved.roleModels ?? {},
    customRoles: saved.customRoles ?? {},
    disabledRoles: saved.disabledRoles ?? [],
    storePromptText: saved.storePromptText ?? true,
    dashboardPort: saved.dashboardPort,
    ...(saved.policy ? { policy: saved.policy } : {}),
  };
}

/** Parses config.json text; a broken file is the server's own state, so it is reason "server" (HTTP 500), not "invalid" (400). */
export function parseConfig(text: string, path: string): Config {
  try {
    return withDefaults(JSON.parse(text) as Partial<Config>);
  } catch (err) {
    throw new CliError(`config.json is not valid JSON: ${(err as Error).message} (${path})`, 1, "server");
  }
}

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(configPath());
  return (await file.exists()) ? parseConfig(await file.text(), configPath()) : withDefaults({});
}

/** Blocking `loadConfig` for the dashboard's per-request meta (the file is tiny); a malformed file throws a CliError. */
export function loadConfigSync(): Config {
  const path = configPath();
  if (!existsSync(path)) return withDefaults({});
  return parseConfig(readFileSync(path, "utf8"), path);
}

export const saveConfig = (config: Config) => writeJson(configPath(), config);

export const isTier = (value: string): value is Tier => (TIERS as string[]).includes(value);
