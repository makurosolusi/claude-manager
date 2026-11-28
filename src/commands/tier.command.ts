import { CliError } from "../cli.error.ts";
import { applyConfig } from "../config/config.apply.ts";
import { loadConfig, TIER_ALIAS, TIER_ENV, TIERS, type Tier } from "../config/config.store.ts";
import { setTierModel } from "../roles/roles.service.ts";
import type { Command } from "./command.types.ts";

const APPLY_NOTE =
  "Applies to new Claude Code sessions; running sessions reload settings and may switch on their next request — restart them to be sure.";

export const tierCommand: Command = {
  name: "tier",
  summary: "Show or change the model behind each tier",
  usage: `Usage: claude-manager tier [set <think|work|basic> <model-id>]

Tiers map to Claude Code aliases: think -> opus, work -> sonnet, basic -> haiku.
"tier set" changes the model ID behind an alias and re-applies every install,
so role files stay unchanged when model names change.

Examples:
  claude-manager tier
  claude-manager tier set think claude-opus-5-5`,
  async run(args) {
    const config = await loadConfig();
    const [sub, tier, model] = args;
    if (!sub) {
      for (const t of TIERS) {
        console.log(`${t.padEnd(6)} ${TIER_ALIAS[t].padEnd(7)} ${config.tiers[t].padEnd(24)} (${TIER_ENV[t]})`);
      }
      return 0;
    }
    if (sub !== "set" || !tier || !model) throw new CliError(`usage: claude-manager tier set <think|work|basic> <model-id>`);
    const { applied } = await applyConfig((c) => setTierModel(c, tier, model));
    console.log(`${tier} (${TIER_ALIAS[tier as Tier]}) -> ${model}; re-applied ${applied} install(s)`);
    console.log(APPLY_NOTE);
    return 0;
  },
};
