/** Model-id rules shared by the server, the CLI and the browser bundle. Pure: no node imports. */

/** Characters a pinned model id may contain; also drops `<synthetic>`. */
export const MODEL_ID_RE = /^[\w.\-:[\]]+$/;
/** Longest model id accepted for a tier or pin. */
export const MODEL_ID_MAX = 128;
/** Claude Code aliases and sentinels: a tier must hold a full model ID, or the alias env would point at itself. */
export const ALIAS_VALUES: readonly string[] = ["opus", "sonnet", "haiku", "fable", "best", "opusplan", "default", "inherit"];
/** Tier → model alias; `TIER_ALIAS` in config.store.ts must equal it (test/model.ids.test.ts). */
export const TIER_ALIAS_MAP = { think: "opus", work: "sonnet", basic: "haiku" } as const;
/** Shown after every tier change (CLI, API notice, editor). */
export const TIER_NEW_SESSIONS_NOTE =
  "Applies to new Claude Code sessions; running sessions reload settings and may switch on their next request — restart them to be sure.";
