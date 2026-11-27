import { join } from "node:path";
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
}

export const configPath = () => join(appDir(), "config.json");

export async function loadConfig(): Promise<Config> {
  const saved = (await readJson<Partial<Config>>(configPath())) ?? {};
  return {
    tiers: { ...DEFAULT_TIER_MODELS, ...saved.tiers },
    roleModels: saved.roleModels ?? {},
    customRoles: saved.customRoles ?? {},
    disabledRoles: saved.disabledRoles ?? [],
  };
}

export const saveConfig = (config: Config) => writeJson(configPath(), config);

export const isTier = (value: string): value is Tier => (TIERS as string[]).includes(value);
