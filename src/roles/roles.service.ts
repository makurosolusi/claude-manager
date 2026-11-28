import { CliError, type ErrorReason } from "../cli.error.ts";
import { type Config, isTier, type Tier, TIERS } from "../config/config.store.ts";
import type { Manifest } from "../install/install.manifest.ts";
import type { AgentInput, AgentPatch, ModelChoice } from "../server/agents.types.ts";
import { PRESET_ROLES } from "./roles.presets.ts";
import { assertRoleName, assertTools, BUILTIN_AGENTS, ownValue } from "./roles.registry.ts";

/** Pure config transforms shared by the CLI and the dashboard API: each returns the next Config or throws a CliError with a reason. */

const PIN = /^[\w.\-:\[\]]+$/;
const MAX_DESCRIPTION = 1000;
const MAX_PROMPT = 20_000;
const MAX_TOOLS = 64;
const MAX_MODEL_ID = 128;
/** Claude Code aliases and sentinels: a tier must hold a full model ID, or the alias env would point at itself. */
const MODEL_ALIASES = ["opus", "sonnet", "haiku", "fable", "best", "opusplan", "default", "inherit"];
/** Tier stored for a custom role created with a pinned model (the pin wins at render time). */
const PINNED_CUSTOM_TIER: Tier = "work";
const INPUT_KEYS = ["name", "description", "model", "tools", "prompt"];
const PATCH_KEYS = ["description", "model", "tools", "prompt", "enabled"];

const fail = (message: string, reason: ErrorReason = "invalid"): never => {
  throw new CliError(message, 1, reason);
};

const isPreset = (name: string) => PRESET_ROLES.some((r) => r.name === name);
const isCustom = (config: Config, name: string) => Object.hasOwn(config.customRoles, name);

function assertKnownKeys(body: object, allowed: string[]): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(`unknown field "${key}"`);
}

function mainAgentOf(manifest: Manifest, name: string) {
  return Object.values(manifest.installs).find((i) => i.mainAgent === name);
}

function assertNotMain(manifest: Manifest, name: string): void {
  const main = mainAgentOf(manifest, name);
  if (main) fail(`"${name}" is the main agent at ${main.settingsPath}; re-install without --main-agent first`, "conflict");
}

function parseDescription(value: unknown): string {
  if (value !== undefined && value !== null && typeof value !== "string") fail("description must be a string");
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) fail("description is required (Claude uses it to pick the agent)");
  if (text.length > MAX_DESCRIPTION) fail(`description is too long (max ${MAX_DESCRIPTION} characters)`);
  return text;
}

/** null = all tools except Agent. */
function parseTools(value: unknown): string[] | undefined {
  if (value === null) return undefined;
  if (!Array.isArray(value) || value.some((t) => typeof t !== "string")) fail("tools must be null or an array of strings");
  const tools = [...new Set((value as string[]).map((t) => t.trim()).filter(Boolean))];
  if (tools.length < 1 || tools.length > MAX_TOOLS) fail(`tools must have 1-${MAX_TOOLS} entries (or null for all)`);
  assertTools(tools);
  return tools;
}

function parsePrompt(value: unknown): string | undefined {
  if (typeof value !== "string") return fail("prompt must be a string");
  if (value.length > MAX_PROMPT) fail(`prompt is too long (max ${MAX_PROMPT} characters)`);
  return value.trim() ? value : undefined;
}

function parseChoice(choice: unknown): ModelChoice {
  const c = (choice ?? {}) as Record<string, unknown>;
  const keys = Object.keys(c);
  if (typeof choice !== "object" || keys.length !== 1) return fail("model must be one of {tier}, {pin} or {default}");
  if ("default" in c && c.default === true) return { default: true };
  if ("tier" in c && typeof c.tier === "string") {
    if (!isTier(c.tier)) fail(`unknown tier "${c.tier}": use ${TIERS.join(", ")}`);
    return { tier: c.tier as Tier };
  }
  if ("pin" in c && typeof c.pin === "string") {
    if (!PIN.test(c.pin)) fail(`invalid tier or model "${c.pin}"`);
    return { pin: c.pin };
  }
  return fail("model must be one of {tier}, {pin} or {default}");
}

function assertRoleExists(config: Config, name: string): void {
  if (!isPreset(name) && !isCustom(config, name)) fail(`role "${name}" not found. Run "claude-manager roles".`, "not_found");
}

/** Creates a custom role; conflicts with presets, customs and Claude Code built-ins. */
export function addRole(config: Config, input: AgentInput): Config {
  assertKnownKeys(input, INPUT_KEYS);
  assertRoleName(input.name);
  if (isPreset(input.name) || isCustom(config, input.name)) fail(`role "${input.name}" already exists`, "conflict");
  if (BUILTIN_AGENTS.some((b) => b.toLowerCase() === input.name.toLowerCase())) {
    fail(`"${input.name}" is a Claude Code built-in agent name`, "conflict");
  }
  const choice = parseChoice(input.model);
  if ("default" in choice) fail("model must be one of {tier} or {pin}");
  const next = structuredClone(config);
  next.customRoles[input.name] = {
    tier: "tier" in choice ? choice.tier : PINNED_CUSTOM_TIER,
    description: parseDescription(input.description),
    tools: parseTools(input.tools),
    prompt: input.prompt === undefined ? undefined : parsePrompt(input.prompt),
  };
  if ("pin" in choice) next.roleModels[input.name] = choice.pin;
  return next;
}

/** Routes a role to a tier, pins a model, or removes the override ({default}). */
export function setRoleModel(config: Config, name: string, choice: ModelChoice): Config {
  assertRoleExists(config, name);
  const parsed = parseChoice(choice);
  const next = structuredClone(config);
  if ("default" in parsed) delete next.roleModels[name];
  else next.roleModels[name] = "tier" in parsed ? parsed.tier : parsed.pin;
  return next;
}

/** Disables a preset (it stays listed); the main agent can't be disabled. */
function disablePreset(config: Config, name: string, manifest: Manifest): Config {
  assertNotMain(manifest, name);
  const next = structuredClone(config);
  if (!next.disabledRoles.includes(name)) next.disabledRoles.push(name);
  delete next.roleModels[name];
  return next;
}

export function enableRole(config: Config, name: string): Config {
  if (!config.disabledRoles.includes(name)) fail(`role "${name}" is not disabled`);
  return { ...structuredClone(config), disabledRoles: config.disabledRoles.filter((r) => r !== name) };
}

/** Edits a role: presets take model/enabled only; customs take description/tools/prompt/model, never enabled. */
export function updateRole(config: Config, name: string, patch: AgentPatch, manifest?: Manifest): Config {
  assertKnownKeys(patch, PATCH_KEYS);
  assertRoleExists(config, name);
  if (isPreset(name)) {
    if (Object.keys(patch).some((k) => k !== "model" && k !== "enabled")) fail("preset agents only allow model and enabled");
  } else if ("enabled" in patch) fail("custom agents have no enabled state; delete it instead");
  let next = structuredClone(config);
  if ("enabled" in patch) {
    if (typeof patch.enabled !== "boolean") fail("enabled must be true or false");
    const disabled = next.disabledRoles.includes(name);
    if (patch.enabled && disabled) next = enableRole(next, name);
    else if (!patch.enabled && !disabled) next = disablePreset(next, name, manifest ?? { version: 1, installs: {} });
  }
  if (patch.model !== undefined) {
    const choice = parseChoice(patch.model);
    const custom = ownValue(next.customRoles, name);
    if (custom && "default" in choice) fail("default model is only for preset agents");
    if (custom && "tier" in choice) {
      custom.tier = choice.tier;
      delete next.roleModels[name]; // a stale pin would shadow the new tier
    } else next = setRoleModel(next, name, choice);
  }
  const custom = ownValue(next.customRoles, name);
  if (custom) {
    if ("description" in patch) custom.description = parseDescription(patch.description);
    if ("tools" in patch) custom.tools = parseTools(patch.tools);
    if ("prompt" in patch) custom.prompt = parsePrompt(patch.prompt);
  }
  return next;
}

/** API delete: custom roles are removed; presets answer 409 (disable them instead). */
export function removeRole(config: Config, name: string, manifest: Manifest): Config {
  assertRoleExists(config, name);
  assertNotMain(manifest, name);
  if (isPreset(name)) fail(`presets can't be deleted; disable it with PATCH {"enabled":false}`, "conflict");
  const next = structuredClone(config);
  delete next.customRoles[name];
  delete next.roleModels[name];
  return next;
}

/** CLI `roles rm`: deletes a custom role, or disables a preset. */
export function disableRole(config: Config, name: string, manifest: Manifest): Config {
  assertNotMain(manifest, name);
  if (isCustom(config, name)) return removeRole(config, name, manifest);
  if (isPreset(name) && !config.disabledRoles.includes(name)) return disablePreset(config, name, manifest);
  return fail(`role "${name}" not found`, "not_found");
}

/** Points a tier at a full model ID; rejects aliases (opus, sonnet, ...) and ids over 128 characters. */
export function setTierModel(config: Config, tier: string, model: string): Config {
  if (!isTier(tier)) fail(`unknown tier "${tier}": use ${TIERS.join(", ")}`);
  if (!PIN.test(model) || model.length > MAX_MODEL_ID) fail(`invalid model id "${model.slice(0, MAX_MODEL_ID)}"`);
  if (MODEL_ALIASES.includes(model.toLowerCase())) fail(`model must be a full model ID, not the alias "${model}"`);
  const next = structuredClone(config);
  next.tiers[tier as Tier] = model;
  return next;
}
