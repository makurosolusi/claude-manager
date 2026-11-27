import { homedir } from "node:os";
import { join } from "node:path";

const home = () => process.env.HOME || homedir();

/** Claude Code config dir (respects CLAUDE_CONFIG_DIR). */
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");

/** claude-manager data dir (override with CLAUDE_MANAGER_HOME). */
export const appDir = () => process.env.CLAUDE_MANAGER_HOME || join(home(), ".claude-manager");

/** Claude Code state file holding the pricing cache (~/.claude.json, or inside CLAUDE_CONFIG_DIR). */
export const claudeStateFile = () =>
  process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home(), ".claude.json");

export const dbPath = () => join(appDir(), "data.db");
