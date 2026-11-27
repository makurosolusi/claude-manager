import type { Usage } from "./pricing.service.ts";

export interface SessionPatch {
  id: string;
  cwd?: string;
  branch?: string;
  version?: string;
  ts?: string;
  title?: string;
  mainAgent?: string;
  ccCost?: number;
}

export interface RequestRow extends Usage {
  message_id: string;
  request_id: string | null;
  session_id: string;
  agent_id: string | null;
  ts: string;
  model: string;
  effort: string | null;
  thinking: number;
  stop_reason: string | null;
  is_sidechain: number;
}

export type ToolCallRow = {
  tool_use_id: string;
  message_id: string;
  session_id: string;
  agent_id: string | null;
  ts: string;
  name: string;
  subagent_type: string | null;
  model: string | null;
}

export type PromptRow = {
  uuid: string;
  prompt_id: string | null;
  session_id: string;
  agent_id: string | null;
  ts: string;
  source: string | null;
  text: string | null;
}

export type CompactionRow = {
  uuid: string;
  session_id: string;
  agent_id: string | null;
  ts: string;
  trigger: string | null;
  pre_tokens: number | null;
  post_tokens: number | null;
}

export interface ParsedEntry {
  session?: SessionPatch;
  request?: RequestRow;
  tools?: ToolCallRow[];
  prompt?: PromptRow;
  compaction?: CompactionRow;
}

export interface ParseContext {
  /** Agent id from the subagent file name; null for a main session file. */
  agentId: string | null;
  storePromptText: boolean;
}

// The transcript format is internal and grows new entry types each release, so only lines that can
// matter are JSON-parsed. Inside JSON strings quotes are escaped, so these raw markers only match keys.
const MARKERS = ['"type":"assistant"', '"type":"user"', '"subtype":"compact_boundary"', '"type":"cost-state"', '"type":"ai-title"', '"type":"agent-setting"'];

export const isCandidate = (line: string) =>
  MARKERS.some((m) => line.includes(m)) && !line.includes('"toolUseResult":');

type Json = Record<string, any>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Maps one transcript entry to DB rows; unknown/irrelevant entries yield {}. */
export function parseEntry(e: Json, ctx: ParseContext): ParsedEntry {
  const sessionId = str(e.sessionId);
  if (!sessionId) return {};
  const ts = str(e.timestamp) ?? undefined;
  const agentId = ctx.agentId ?? str(e.agentId);

  switch (e.type) {
    case "ai-title":
      return { session: { id: sessionId, title: str(e.aiTitle) ?? undefined } };
    case "agent-setting":
      return { session: { id: sessionId, mainAgent: str(e.agentSetting) ?? undefined } };
    case "cost-state":
      // Only the main transcript's running total describes the session.
      return ctx.agentId || typeof e.totalCostUSD !== "number" ? {} : { session: { id: sessionId, ccCost: e.totalCostUSD } };
    case "system":
      if (e.subtype !== "compact_boundary" || !ts || !str(e.uuid)) return {};
      return {
        compaction: {
          uuid: e.uuid,
          session_id: sessionId,
          agent_id: agentId,
          ts,
          trigger: str(e.compactMetadata?.trigger),
          pre_tokens: e.compactMetadata?.preTokens ?? null,
          post_tokens: e.compactMetadata?.postTokens ?? null,
        },
      };
    case "assistant":
    case "user":
      break;
    default:
      return {};
  }
  if (!ts) return {};
  const session: SessionPatch = {
    id: sessionId,
    ts,
    cwd: str(e.cwd) ?? undefined,
    branch: str(e.gitBranch) ?? undefined,
    version: str(e.version) ?? undefined,
  };
  return e.type === "assistant" ? { session, ...parseAssistant(e, sessionId, agentId, ts) } : { session, ...parseUser(e, sessionId, agentId, ts, ctx) };
}

function parseAssistant(e: Json, sessionId: string, agentId: string | null, ts: string): ParsedEntry {
  const m = e.message;
  const u = m?.usage;
  if (!u || !str(m.id) || !str(m.model) || m.model === "<synthetic>") return {};
  const split = u.cache_creation;
  const request: RequestRow = {
    message_id: m.id,
    request_id: str(e.requestId),
    session_id: sessionId,
    agent_id: agentId,
    ts,
    model: m.model,
    effort: str(e.effort),
    speed: str(u.speed),
    geo: str(u.inference_geo),
    input: num(u.input_tokens),
    // Old transcripts have no 5m/1h split; all writes were 5m then.
    cache_5m: split ? num(split.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens),
    cache_1h: split ? num(split.ephemeral_1h_input_tokens) : 0,
    cache_read: num(u.cache_read_input_tokens),
    output: num(u.output_tokens),
    thinking: num(u.output_tokens_details?.thinking_tokens),
    web_search: num(u.server_tool_use?.web_search_requests),
    stop_reason: str(m.stop_reason),
    is_sidechain: e.isSidechain ? 1 : 0,
  };
  const tools: ToolCallRow[] = (Array.isArray(m.content) ? m.content : [])
    .filter((b: Json) => b?.type === "tool_use" && str(b.id) && str(b.name))
    .map((b: Json) => ({
      tool_use_id: b.id,
      message_id: m.id,
      session_id: sessionId,
      agent_id: agentId,
      ts,
      name: b.name,
      subagent_type: str(b.input?.subagent_type),
      model: str(b.input?.model),
    }));
  return { request, tools };
}

function parseUser(e: Json, sessionId: string, agentId: string | null, ts: string, ctx: ParseContext): ParsedEntry {
  if (e.isMeta || e.toolUseResult !== undefined || !str(e.uuid)) return {};
  const content = e.message?.content;
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content) && !content.some((b: Json) => b?.type === "tool_result")) {
    text = content.filter((b: Json) => b?.type === "text").map((b: Json) => b.text).join("\n");
  } else return {};
  const source = str(e.origin?.kind) ?? str(e.turnOrigin) ?? str(e.promptSource);
  return {
    prompt: {
      uuid: e.uuid,
      prompt_id: str(e.promptId),
      session_id: sessionId,
      agent_id: agentId,
      ts,
      source: source?.replace(/_/g, "-") ?? null,
      text: ctx.storePromptText ? text : null,
    },
  };
}
