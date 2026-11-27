import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../cli.error.ts";
import { appDir } from "../app.paths.ts";
import { readJson, writeJson } from "../storage/json.file.ts";

export type Tier = "think" | "work" | "basic";
export const TIERS: Tier[] = ["think", "work", "basic"];

export const TIER_ALIAS: Record<Tier, "opus" | "sonnet" | "haiku"> = {
  think: "opus",
  work: "sonnet",
  basic: "haiku",
};

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
  };
}

export async function loadConfig(): Promise<Config> {
  return withDefaults((await readJson<Partial<Config>>(configPath())) ?? {});
}

/** Blocking `loadConfig` for the dashboard's per-request meta (the file is tiny); a malformed file throws a CliError. */
export function loadConfigSync(): Config {
  const path = configPath();
  if (!existsSync(path)) return withDefaults({});
  try {
    return withDefaults(JSON.parse(readFileSync(path, "utf8")) as Partial<Config>);
  } catch (err) {
    throw new CliError(`invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

export const saveConfig = (config: Config) => writeJson(configPath(), config);

export const isTier = (value: string): value is Tier => (TIERS as string[]).includes(value);
