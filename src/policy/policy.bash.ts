import { SHELL_META_RE, TEST_COMMAND_MAX_CHARS } from "./policy.presets.ts";
import type { Capability } from "./policy.types.ts";

// Bash command text heuristics for the hook (§3 steps 1, 2, 4, §10). Hook fast path: no imports beyond presets.
// ponytail: text heuristics, not a sandbox; `.env` also hits `process.env` (false deny, never a false allow).
export const SECRET_CMD_RE =
  /\.env\b|\.envrc\b|id_(?:rsa|dsa|ecdsa|ed25519)|\.(?:pem|key|p12|pfx)\b|\.ssh\b|\.aws\b|credentials\.json|service-account\.json/;
/** Names a glob in the command must not be able to expand to (secret files and owner-only words). */
const GLOB_PROBES = [".env", ".env.local", ".envrc", "id_rsa", "id_ed25519", "credentials.json", "service-account.json"];
const WORD_SPLIT_RE = /[\s;&|()<>$`{}=,:/]+/;
const SHELL_WORD_RE = /[\s;&|()<>`/]+/;
const RECURSIVE_FLAG_RE = /^-[a-z]*r/;
const GIT_LOCAL = ["add", "commit", "switch", "checkout", "restore", "stash", "branch"];
/** `gh <x> <sub>` forms that change the remote like a push does (`gh pr merge`, `gh repo sync`). */
const GH_REMOTE_SUBCOMMANDS = ["merge", "sync"];
/** npm accepts any unique prefix of a command (`npm pub` = publish, checked on npm 11). */
const NPM_ABBREV: [string, number][] = [["publish", 2], ["unpublish", 3]];

/** Quotes and backslashes removed, so `.e""nv`, `.\env` and `"git" push` read as the shell would. */
export const unquote = (cmd: string) => cmd.replace(/[\\'"]/g, "");

const words = (cmd: string) => unquote(cmd).toLowerCase().split(WORD_SPLIT_RE).filter(Boolean);
/** `http-push`, `pre-release`: the part after the last `-` counts as a word too. */
const tail = (w: string) => w.slice(w.lastIndexOf("-") + 1);

/** §3 step 2: an owner-only word anywhere (stricter than "after git/npm/…"), or `rm` with a recursive flag. */
export function isOwnerOnly(cmd: string, tokens: Set<string>): boolean {
  const ws = words(cmd);
  if (ws.some((w) => tokens.has(w) || tokens.has(tail(w)))) return true;
  if (ws.includes("gh") && ws.some((w) => GH_REMOTE_SUBCOMMANDS.includes(w))) return true;
  if (ws.includes("npm") && ws.some((w) => NPM_ABBREV.some(([full, min]) => w.length >= min && full.startsWith(w)))) return true;
  return ws.includes("rm") && ws.some((w) => w === "--recursive" || RECURSIVE_FLAG_RE.test(w));
}

/** Shell glob (`*`, `?`, `[..]`) → regex; a leading wildcard doesn't match a dotfile, as in bash without dotglob. */
function globRe(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\[!/g, "[^");
  return new RegExp(`^${/^[*?[]/.test(glob) ? "(?!\\.)" : ""}${body}$`, "i");
}

/**
 * True when the text can't show what runs: an expansion (`$`, backtick, `eval`), brace expansion, or a glob that could
 * expand to an owner-only word or a secret file name. Such a command never ends in `allow` (rule `owner-check-uncertain`),
 * because the owner-only and secret floors only see the literal text (`git pu$(true)sh`, `git pus?`, `cat .en?`).
 * ponytail: shell=allow is still arbitrary code (`base64 -d | sh`, a script file); this closes the inline-text forms only.
 */
export function isUncertain(cmd: string, tokens: Set<string>): boolean {
  const flat = unquote(cmd);
  if (/[$`]/.test(flat) || /\beval\b/i.test(flat) || /\{[^}]*,[^}]*\}/.test(flat)) return true;
  const probes = [...GLOB_PROBES, ...tokens];
  return flat.split(SHELL_WORD_RE).filter((w) => /[*?[]/.test(w)).some((w) => {
    let re: RegExp;
    try {
      re = globRe(w);
    } catch (err) {
      if (err instanceof SyntaxError) return true; // e.g. an unclosed `[`: can't tell what it expands to
      throw err;
    }
    return probes.some((p) => re.test(p));
  });
}

/** §3 step 4: simple = no metacharacter (or stray quote) left after dropping single-quoted spans. */
export const isSimple = (cmd: string) => {
  const rest = cmd.replace(/'[^']*'/g, "");
  return !SHELL_META_RE.test(rest) && !rest.includes("'");
};
const squash = (s: string) => s.trim().split(/\s+/).join(" ");

/** Capability of a Bash command; compound commands fall to `shell`. */
export function bashCap(cmd: string, testCommands: string[]): { cap: Capability; compound: boolean } {
  if (!isSimple(cmd)) return { cap: "shell", compound: true };
  const ws = squash(cmd).split(" ");
  const line = ws.join(" ");
  const tests = testCommands.filter((t) => t.trim() && t.length <= TEST_COMMAND_MAX_CHARS && isSimple(t) && !t.includes("'")).map(squash);
  if (tests.some((t) => line === t || line.startsWith(`${t} `))) return { cap: "test", compound: false };
  if (ws[0] === "git" && GIT_LOCAL.includes(ws[1] ?? "")) return { cap: "git", compound: false };
  return { cap: "shell", compound: false };
}
