import type { Tier } from "../../config/config.store.ts";
import type { AgentDetail, AgentInput, AgentPatch, AgentKind } from "../../server/agents.types.ts";
import type { ChainInput } from "./agents.table.ts";

/** Max description length (server rule, spec 3.1). */
export const DESCRIPTION_MAX = 1000;
/** Max system prompt length (server rule, spec 3.1). */
export const PROMPT_MAX = 20000;
/** Fraction of PROMPT_MAX at which the counter turns to a warning tone. */
export const PROMPT_WARN_RATIO = 0.9;
/** Max tools in "only these" mode. */
export const TOOLS_MAX = 64;

const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
const PIN_RE = /^[\w.\-:[\]]+$/;
/** Valid MCP tool entry: `mcp__server` or `mcp__server__tool` (tool may be `*`). */
export const MCP_RE = /^mcp__[\w-]+(__[\w*-]+)?$/;
// Mirrors TIER_ALIAS in config.store.ts (not importable here: that module pulls in node).
const TIER_ALIAS: Record<Tier, string> = { think: "opus", work: "sonnet", basic: "haiku" };

export type ModelMode = "tier" | "pin" | "default";
export type ToolsMode = "all" | "only";
export interface FormState {
  name: string;
  description: string;
  modelMode: ModelMode;
  /** Tier name (mode tier) or model alias/ID (mode pin); ignored for default. */
  modelValue: string;
  toolsMode: ToolsMode;
  tools: string[];
  mcp: string[];
  prompt: string;
  /** Presets only. */
  enabled: boolean;
}
export type FormErrors = Partial<Record<"name" | "description" | "model" | "tools" | "mcp" | "prompt", string>>;

/** Blank create form: work tier, all tools. */
export const emptyForm = (): FormState => ({ name: "", description: "", modelMode: "tier", modelValue: "work", toolsMode: "all", tools: [], mcp: [], prompt: "", enabled: true });

/** Form state for editing an existing agent. */
export function fromDetail(d: AgentDetail): FormState {
  const modelMode: ModelMode = d.pin ? "pin" : d.tier ? "tier" : "default";
  const tools = d.tools ?? [];
  return {
    name: d.name, description: d.description ?? "", modelMode, modelValue: d.pin ?? d.tier ?? "",
    toolsMode: d.tools ? "only" : "all",
    tools: tools.filter((t) => !t.startsWith("mcp__")), mcp: tools.filter((t) => t.startsWith("mcp__")),
    prompt: d.prompt_source === "default" ? "" : d.prompt ?? "", enabled: d.status === "enabled",
  };
}

/** Splits on commas and newlines, trims, drops empties and duplicates (first wins). */
export const parseMcpList = (text: string): string[] => [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];

const allTools = (s: FormState): string[] => [...new Set([...s.tools, ...s.mcp])];

/** Field -> message map mirroring the server rules (spec 3.1); empty when valid. Presets only check the model. */
export function validate(s: FormState, o: { isCreate: boolean; kind: AgentKind }): FormErrors {
  const e: FormErrors = {};
  if (s.modelMode === "pin" && !PIN_RE.test(s.modelValue)) e.model = `invalid model id "${s.modelValue}"`;
  if (s.modelMode === "tier" && !["think", "work", "basic"].includes(s.modelValue)) e.model = `invalid tier "${s.modelValue}"`;
  if (s.modelMode === "default" && o.kind !== "preset") e.model = "only preset agents can use the default model";
  if (o.kind === "preset") return e;
  if (o.isCreate && !NAME_RE.test(s.name)) e.name = `invalid role name "${s.name}": use lowercase letters, digits and dashes`;
  const d = s.description.trim();
  if (!d) e.description = "description is required (Claude uses it to pick the agent)";
  else if (d.length > DESCRIPTION_MAX) e.description = `description is too long (max ${DESCRIPTION_MAX} characters)`;
  if (s.toolsMode === "only") {
    const bad = s.mcp.find((m) => !MCP_RE.test(m));
    if (bad) e.mcp = `invalid MCP tool "${bad}": use mcp__server or mcp__server__tool`;
    const n = allTools(s).length;
    if (n === 0) e.tools = "select at least one tool, or choose all tools";
    else if (n > TOOLS_MAX) e.tools = `too many tools (max ${TOOLS_MAX})`;
  }
  if (s.prompt.length > PROMPT_MAX) e.prompt = `prompt is too long (max ${PROMPT_MAX} characters)`;
  return e;
}

const modelOf = (s: FormState): AgentInput["model"] => (s.modelMode === "pin" ? { pin: s.modelValue } : { tier: s.modelValue as Tier });
const toolsOf = (s: FormState): string[] | null => (s.toolsMode === "all" ? null : allTools(s));

/** Create body; an empty prompt is omitted so the server uses its default. */
export function toInput(s: FormState): AgentInput {
  const input: AgentInput = { name: s.name, description: s.description.trim(), model: modelOf(s), tools: toolsOf(s) };
  if (s.prompt) input.prompt = s.prompt;
  return input;
}

/** PATCH body with only the keys that differ from `a`; presets yield only model/enabled. */
export function toPatch(a: FormState, b: FormState, kind: AgentKind): AgentPatch {
  const p: AgentPatch = {};
  if (a.modelMode !== b.modelMode || a.modelValue !== b.modelValue) p.model = b.modelMode === "default" ? { default: true } : modelOf(b);
  if (kind === "preset") {
    if (a.enabled !== b.enabled) p.enabled = b.enabled;
    return p;
  }
  if (a.description.trim() !== b.description.trim()) p.description = b.description.trim();
  if (JSON.stringify(toolsOf(a)) !== JSON.stringify(toolsOf(b))) p.tools = toolsOf(b);
  if (a.prompt !== b.prompt) p.prompt = b.prompt;
  return p;
}

/** True when any field differs (tool order and mcp order count as differences only by content). */
export const isDirty = (a: FormState, b: FormState): boolean => JSON.stringify(norm(a)) !== JSON.stringify(norm(b));
const norm = (s: FormState) => ({ ...s, tools: [...s.tools].sort(), mcp: [...s.mcp].sort() });

/** Chain for the ModelChain preview: tier -> alias -> model ID, a pin, or inherit for default. */
export function previewChain(s: FormState, tiers: Record<Tier, string>): ChainInput {
  if (s.modelMode === "tier" && s.modelValue in tiers) {
    const tier = s.modelValue as Tier;
    return { tier, pin: null, alias: TIER_ALIAS[tier], model_id: tiers[tier] };
  }
  if (s.modelMode === "pin" && s.modelValue) return { tier: null, pin: s.modelValue, alias: s.modelValue, model_id: s.modelValue };
  return { tier: null, pin: null, alias: null, model_id: null };
}

/** Field a server 400 message names, else null (show it in the banner). */
export function fieldForError(message: string): keyof FormErrors | null {
  const m = message.toLowerCase();
  if (/\bmcp\b/.test(m)) return "mcp";
  if (/^(unknown|too many) tool|\btools?\b/.test(m)) return "tools";
  if (/^(invalid role name|role ".*" already exists)|\bname\b/.test(m)) return "name";
  if (m.startsWith("description")) return "description";
  if (/^(invalid (model|tier)|model)/.test(m)) return "model";
  if (m.startsWith("prompt")) return "prompt";
  return null;
}
