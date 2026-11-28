export interface AgentMeta {
  name?: string;
  description?: string;
  color?: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
}

export interface ParsedAgentFile {
  meta: AgentMeta;
  /** Text after the closing `---` (the whole file when there is no valid frontmatter). */
  body: string;
  /** Set when the frontmatter is malformed (opened but never closed). */
  warning?: string;
}

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1); // not valid JSON escapes: keep the raw text between the quotes
    }
  }
  return v.length >= 2 && v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1) : v;
}

/**
 * Reads the subagent fields claude-manager displays from a `.md` file's frontmatter.
 * ponytail: line parser, no YAML lists/multiline; swap for a YAML parser if externals render wrong.
 */
export function parseAgentFile(text: string): ParsedAgentFile {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { meta: {}, body: text.trim() };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { meta: {}, body: text.trim(), warning: "frontmatter is not closed with ---" };
  const raw: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) raw[m[1]!] = unquote(m[2]!.trim());
  }
  const meta: AgentMeta = {};
  if (raw.name) meta.name = raw.name;
  if (raw.description) meta.description = raw.description;
  if (raw.color) meta.color = raw.color;
  if (raw.model) meta.model = raw.model;
  if (raw.tools) meta.tools = list(raw.tools);
  if (raw.disallowedTools) meta.disallowedTools = list(raw.disallowedTools);
  return { meta, body: lines.slice(end + 1).join("\n").trim() };
}
