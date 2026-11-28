export interface BuiltinAgentInfo {
  description: string;
  model: "opus" | "sonnet" | "haiku" | "inherit";
  tools: "read-only" | "all" | null;
}

/** Claude Code's built-in subagents. Source: https://code.claude.com/docs/en/sub-agents (verified 2026-11-28). */
export const BUILTIN_AGENT_INFO: Record<string, BuiltinAgentInfo> = {
  Explore: { description: "Fast, read-only agent for searching and analyzing codebases: file discovery, code search, exploration. Runs on the opus alias on the Anthropic API and subscriptions.", model: "opus", tools: "read-only" },
  Plan: { description: "Research agent used in plan mode to gather context before presenting a plan.", model: "inherit", tools: "read-only" },
  "general-purpose": { description: "Capable agent for complex, multi-step tasks that need both exploration and action.", model: "inherit", tools: "all" },
  claude: { description: "Catch-all when a task doesn't fit a specialized agent.", model: "inherit", tools: "all" },
  "statusline-setup": { description: "Configures the status line when you run /statusline.", model: "sonnet", tools: null },
  "claude-code-guide": { description: "Answers questions about Claude Code features.", model: "haiku", tools: null },
  "web-fetch": { description: "Reads a web page for the session (falls back to the conversation's model when Haiku is unavailable).", model: "haiku", tools: null },
};
