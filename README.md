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

## Usage

```bash
claude-manager install                      # ~/.claude (use --scope project for ./.claude)
claude --agent manager                      # start a swarm session
claude-manager roles                        # list roles
claude-manager roles set architect fable    # pin a model to one role
claude-manager roles add ui-ux --tier work --tools Read,Grep,Glob,Edit,Write \
  --description "Designs UI layouts, accessibility and visual polish"
claude-manager tier set think claude-opus-5-5
claude-manager doctor
claude-manager uninstall                    # reverts exactly what install wrote
```

`install --dry-run` shows the changes without writing anything. Files the tool did not create are
never overwritten without `--force`, and with `--force` they are backed up and restored on uninstall.
State is kept in `~/.claude-manager/` (override with `CLAUDE_MANAGER_HOME`).

## Development

```bash
bun install
bun test
bun run typecheck
bun run build        # dist/claude-manager for this machine
bun run build:all    # all release targets
```
