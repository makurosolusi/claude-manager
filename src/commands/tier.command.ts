import { CliError } from "../cli.error.ts";
import { isTier, loadConfig, saveConfig, TIER_ALIAS, TIER_ENV, TIERS } from "../config/config.store.ts";
import { reapplyAll } from "../install/install.service.ts";
import type { Command } from "./command.types.ts";

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
    if (!isTier(tier)) throw new CliError(`unknown tier "${tier}": use ${TIERS.join(", ")}`);
    if (!/^[\w.\-:\[\]]+$/.test(model)) throw new CliError(`invalid model id "${model}"`);
    config.tiers[tier] = model;
    await saveConfig(config);
    const applied = await reapplyAll(config);
    console.log(`${tier} (${TIER_ALIAS[tier]}) -> ${model}; re-applied ${applied.length} install(s)`);
    return 0;
  },
};
