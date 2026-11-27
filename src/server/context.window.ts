/** Standard context window (tokens) for models without 1M support. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;
/** 1M-token context window. */
export const LONG_CONTEXT_WINDOW = 1_000_000;

// Models whose context window is 1M (Anthropic models overview, checked 2026-11-27).
const LONG_CONTEXT_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
];

/**
 * Context window for a request's model.
 * ponytail: estimate. Transcripts don't record the window, so it is inferred from the model id,
 * a `[1m]` suffix, or a session prompt that already exceeded the default window.
 */
export function contextWindow(model: string, maxPrompt: number): number {
  if (/\[1m\]$/i.test(model) || maxPrompt > DEFAULT_CONTEXT_WINDOW) return LONG_CONTEXT_WINDOW;
  const id = model.replace(/\[.*$/, "").replace(/-\d{8}$/, "");
  return LONG_CONTEXT_PREFIXES.some((p) => id === p || id.startsWith(`${p}-`)) ? LONG_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
}
