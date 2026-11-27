# claude-manager

Single-binary CLI that installs a tiered **swarm of role agents** into Claude Code
(thinking on opus, normal work on sonnet, basic work on haiku) and analyses
Claude Code usage logs.

## Roles and tiers

```
Role (manager, coder, ...) -> Tier (think/work/basic) -> Alias (opus/sonnet/haiku) -> Model ID
   .claude/agents/<role>.md                                  frontmatter `model:`      settings.json env ANTHROPIC_DEFAULT_*_MODEL
```

| Role | Tier | Tools |
|---|---|---|
| manager | think | Agent, Read, Grep, Glob, task tools (no Edit/Write/Bash) |
| architect | think | Read, Grep, Glob, WebSearch, WebFetch |
| researcher | basic | Read, Grep, Glob, WebSearch, WebFetch |
| coder | work | everything except Agent |
| reviewer | work | Read, Grep, Glob, Bash |
| writer | basic | Read, Grep, Glob, Edit, Write |

When model names change, run `claude-manager tier set <tier> <model-id>`. Role files stay the same.
The manager can also pick a cheaper or stronger model per task through the Agent tool's `model` parameter.

## Install

> The repository is not published yet. `OWNER` below is a placeholder until the release repo is set.

```bash
curl -fsSL https://github.com/OWNER/claude-manager/releases/latest/download/install.sh | sh
```

The script picks the binary for your OS/arch, verifies it against `SHA256SUMS` and installs it.

| Env | Default | Meaning |
|---|---|---|
| `CLAUDE_MANAGER_VERSION` | `latest` | Release to install, e.g. `0.1.0` or `v0.1.0` |
| `CLAUDE_MANAGER_INSTALL_DIR` | `~/.local/bin` | Where the binary goes (warns if it is not in `PATH`) |

Manual install: download `claude-manager-<os>-<arch>` and `SHA256SUMS` from the Releases page, then

```bash
grep ' claude-manager-darwin-arm64$' SHA256SUMS | shasum -a 256 -c   # Linux: sha256sum -c
chmod +x claude-manager-darwin-arm64 && mv claude-manager-darwin-arm64 ~/.local/bin/claude-manager
```

Supported: macOS and Linux, x64 and arm64. The Windows build (`claude-manager-windows-x64.exe`) is
experimental: no install script and no self-update.

## Usage

```bash
claude-manager install                      # ~/.claude (use --scope project for ./.claude)
claude --agent manager                      # start a swarm session
claude-manager roles                        # list roles
claude-manager roles set architect fable    # pin a model to one role
claude-manager roles add ui-ux --tier work --tools Read,Grep,Glob,Edit,Write \
  --description "Designs UI layouts, accessibility and visual polish"
claude-manager tier set think claude-opus-5-5
claude-manager doctor                       # health checks, exits 1 if any fails
claude-manager uninstall                    # reverts exactly what install wrote

claude-manager sync                         # import new transcript lines into the local DB
claude-manager stats                        # by model, last 30 days
claude-manager stats --by role --since 7d
claude-manager stats --by day --since 2026-11-01 --project my-app --json
claude-manager dashboard                    # http://127.0.0.1:5757
claude-manager dashboard --port 8080
claude-manager update --check               # is a newer release available?
claude-manager update                       # download, verify SHA256, replace the binary
```

`install --dry-run` shows the changes without writing anything. Files the tool did not create are
never overwritten without `--force`, and with `--force` they are backed up and restored on uninstall.
State is kept in `~/.claude-manager/` (override with `CLAUDE_MANAGER_HOME`).

`stats --by` takes `model`, `role`, `project` or `day`; `--since` takes `7d`, `24h` or a date
(default `30d`); `--limit` caps rows (default 20). `stats` syncs first, so a separate `sync` is optional.
`claude-manager <command> --help` shows every option.

## Usage analytics & privacy

- `sync` reads `~/.claude/projects/**/*.jsonl` incrementally into `~/.claude-manager/data.db`.
  Nothing leaves your machine.
- Prompt text is stored by default. Set `"storePromptText": false` in `~/.claude-manager/config.json`
  to keep metadata only.
- The dashboard is read-only, listens on 127.0.0.1 only and rejects requests with a foreign `Host`
  header. It picks up new transcript data every 5s.
- Costs are estimates at API list prices, priced by the model that served each request. They are not
  your bill, and subscription plans are not billed this way. Prices come from built-in defaults, then
  Claude Code's local price cache, then `~/.claude-manager/pricing.json` (last wins per model ID).
  Costs are recomputed when prices change.
- Background calls that Claude Code does not write to transcripts (e.g. title generation) are not counted.
- Remaining context is an estimate: transcripts do not record the context window, so it is inferred
  from the model ID.

## Configuration

`~/.claude-manager/config.json` (also holds tier, role and install state written by the CLI):

| Field | Default | Meaning |
|---|---|---|
| `storePromptText` | `true` | Store prompt text in `data.db`; `false` = metadata only |
| `dashboardPort` | `5757` | Port for `dashboard`; `--port` overrides it |

`pricing.json` maps a model ID to rates in USD per million tokens, in the same shape as Claude Code's
price cache:

```json
{
  "claude-sonnet-5-5": {
    "inputTokens": 2, "outputTokens": 10,
    "promptCacheWriteTokens": 2.5, "promptCacheWrite1hTokens": 4, "promptCacheReadTokens": 0.1
  }
}
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run build        # dist/claude-manager for this machine
bun run build:all    # all release targets
bun run dev dashboard   # run the dashboard from source
```

In dev, `bunfig.toml` runs Tailwind for the dashboard's HTML import. Compiled builds pass the
Tailwind plugin through `scripts/build.ts` instead, and the binary ignores `.env` and `bunfig.toml`
in the user's working directory.

### Releasing

1. Bump `version` in `package.json`.
2. Add a `CHANGELOG.md` entry for that version.
3. Push tag `v<version>` (e.g. `git tag v0.1.0 && git push origin v0.1.0`).

The `release` workflow checks that the tag matches `package.json`, runs tests, typecheck and
`build:all`, then publishes the binaries, `SHA256SUMS` and `install.sh` as a GitHub release.
