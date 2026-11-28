# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-28

### Added

- Permission policy, so workers stop asking for every tool while you stay in control:
  - Three presets, Strict, Balanced (recommended) and Autonomous, decide per role what workers may do
    without asking. The capabilities are read, edit, test, shell, web, agents, git, push and mcp. Balanced is
    recommended because shell still asks there; Autonomous lets workers run any shell command without asking.
  - Owner floors are written to your settings and cannot be switched off from the UI. Push, publish, deploy
    and recursive delete ask you, and push can never be set to allow. These checks read the command text, so
    unusual forms may not be caught. Secrets (`.env*`, keys,
    credentials) are always denied.
  - The policy runs as a PreToolUse hook, `claude-manager hook pre-tool-use`, in the same binary. The hook
    fails open: if it fails, Claude Code's normal prompts apply.
  - Applying is atomic and shows a preview diff before anything is written. Your own existing rules are never
    removed. A repo that ships its own agent file with the same name as a managed role does not inherit that
    role's rights.
  - Scope is user (`~/.claude/settings.json`) by default. `--scope project` writes
    `.claude/settings.local.json`, never the committed file. `defaultMode` is only changed if you opt in with
    `--accept-edits`.
- `claude-manager policy show | apply <preset> | set <row> <capability> <allow|ask|deny|default> | enable |
  disable | audit`. `apply` takes `--scope user|project`, `--accept-edits`, `--dry-run` and `--yes`.
- Dashboard:
  - A Permission policy page (`#/policy`, reached from Agents) with preset setup, a diff preview, a confirm
    step, a per-role matrix editor (edited cells are marked) and the owner floors.
  - A "Set up policy" banner on Overview, Agents and agent detail until a policy is enforced.
  - An "Effective permission" column on Agents (wide screens) and a Permissions panel on agent detail.
  - A policy audit table (`#/policy/audit`) with filters.
- Policy audit: each allow, ask and deny the hook decides is logged locally, without tool inputs, paths or
  commands. Rows are kept 30 days or up to 200,000 rows, the log file rotates at 5 MiB, and `sync` ingests it.
- `doctor` checks whether the policy is enforced, and whether the hook is missing, edited or points at a moved
  binary. It also checks for a stale snapshot, session modes, deny rules that conflict with the policy, and
  managed settings (including `managed-settings.d`).

### Changed

- The role names `main` and `unknown` are reserved.
- Sync warnings are shown in the CLI and in the dashboard header.
- The dashboard header is more compact on narrow desktop widths.
- `install` and `uninstall` refresh the policy snapshot, so reinstalling into a project keeps the policy working.
- Database migration v4 adds the `policy_decisions` table.
- Rollback: a binary older than 0.4.0 cannot open a v4 `data.db`. To downgrade, delete
  `~/.claude-manager/data.db` (or `$CLAUDE_MANAGER_HOME/data.db`). `sync` rebuilds it from your transcripts;
  only the policy audit rows are lost. To remove the policy, run `claude-manager policy disable` or
  `claude-manager uninstall`.

### Fixed

- `uninstall` now restores `settings.json` byte for byte even when it had no `env` section. This bug existed
  before 0.4.0.

## [0.3.0] - 2026-11-28

### Added

- Agents page (`#/agents`, fourth item in the navigation):
  - A list of every agent: preset, custom and external (built-ins, hand-written files, and plugin agents seen
    in your usage), grouped by level by default. Built-in agents have descriptions from the Claude Code docs.
  - A detail view per agent with its prompt, tools, install files and their state (installed, edited, missing
    or shadowed), 30-day usage and warnings.
  - A hierarchy panel: You, the main agent, then the Think, Work and Basic tier cards with the model, the
    price per MTok and the 30-day cost.
- Create, edit, delete, disable and enable managed agents from the dashboard. Deleting asks for confirmation,
  leaving a form with unsaved changes asks first, and each save shows a notice with the live-effect note.
- Edit the model behind a tier from the dashboard (`GET /api/tiers`, `PUT /api/tiers/:tier`). The model picker
  shows prices and a 30-day cost estimate (the same tokens re-priced), a "Newer" hint, a preview of the
  affected agents and a warning when you switch model family. The notice says: "Applies to new Claude Code
  sessions; running sessions reload settings and may switch on their next request — restart them to be sure."
- `claude-manager dashboard --read-only` turns all writes off. The UI hides the controls and the API
  returns 403.
- `claude-manager roles edit <name>` with `--description`, `--tier`, `--pin`, `--default`,
  `--tools <A,B|all>`, `--prompt-file`, `--enable` and `--disable`. It shares code with the dashboard and
  gives the same result. `--tier`, `--pin` and `--default` are mutually exclusive, and so are `--enable` and
  `--disable`.
- Safer dashboard writes: every write needs a per-process token and a same-origin request, a JSON body of at
  most 64 KiB, and an `If-Match` header (412 when it is stale, 428 when it is missing). `config.json` is
  backed up before each write (the last 20 are kept in `~/.claude-manager/backups/`) and written atomically.
  If applying a change fails, config and files are rolled back. An agent file you edited by hand blocks writes
  with a 409 and an `install --force` hint.

### Changed

- **Breaking:** `claude-manager tier set <tier> <model>` now rejects aliases (`opus`, `sonnet`, `haiku`,
  `fable`, `best`, `opusplan`, `default`, `inherit`) and ids longer than 128 characters. Claude Code needs a
  full model name in `ANTHROPIC_DEFAULT_*_MODEL`. Use a full id such as `claude-opus-5-5`. `tier set` also
  prints the new-sessions note.
- Session detail: a capped summary row (Models, Tools used, By role) and tabs (Requests, Agents, Prompts).
  The Agents tab is a searchable, paginated table and replaces the unbounded tree.
- Roles page: one table with a By role / By model / By tier switch replaces the three stacked tables. Each
  role has an "Open on the Agents page" link. Old `?group=` links still work.
- Projects page: shows the full working directory (`~`-relative) under each project name, with a copy
  button, and groups by folder by default. Rows are classified as Project, Worktree, Temp dir, Home or Other,
  with a Kind facet. Temp dirs, home and paths outside home go into named groups at the bottom.
- A broken `config.json` is reported as a server error (500) by the API, and the dashboard header shows it
  before sync errors.
- Upgrading from 0.2.0: 0.2.1 was never published as a tag, so its migration (v3, below) applies to you. The
  first sync reads all transcripts again once. 0.3.0 adds no database migration.
- Rollback: binaries older than 0.2.1 cannot open a v3 database (see the 0.2.1 note). Config backups are in
  `~/.claude-manager/backups/`.

### Fixed

- Concurrent dashboard saves can no longer silently overwrite each other.
- Agent names such as `__proto__` are rejected.
- Browser Back while editing keeps the history intact.
- A network error is no longer shown as "read-only".
- A directory or broken symlink in an agents folder no longer breaks the Agents page.

## [0.2.1] - 2026-11-28

### Added

- A "rerouted" indicator wherever a request was served by a different model than the one requested: a badge
  and filter in a session's request table, a chip in the session header, a marker on Sessions, a column on
  Roles and a count under the Requests card on Overview.
- Fable models have their own colour (plum).
- Custom roles and external agents (such as `general-purpose`, `Explore` or `fork`) use outlined colours,
  so they stand apart from the preset roles.
- `doctor` warns when model routing can be overridden: `ANTHROPIC_BASE_URL`,
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, a project agent file that shadows an installed role, or unmapped
  model aliases.

### Changed

- The cost heat marker is gone.
- The Kind column in By role shows preset, custom or external.
- Database migration v3 adds the requested model to each request. The first sync after upgrading reads all
  transcripts again once, which can take a minute on a large history.
- Rollback: a v0.2.0 binary refuses a v3 database with
  `data.db schema v3 is newer than this claude-manager (v2); upgrade the binary`. To downgrade, run
  `sqlite3 ~/.claude-manager/data.db "PRAGMA user_version = 2"` first (use `$CLAUDE_MANAGER_HOME/data.db`
  if you set that variable). The extra column stays in the file and is harmless.

### Fixed

- The screen no longer flickers on auto-refresh. Changing the range or a filter dims the table instead of
  showing a loading skeleton.
- Roles page: grouped rows no longer repeat the group value, the Σ clutter is gone, the cache subtotal is
  filled in, Kind is correct, column widths fit their content, the layout works at 1024px, and a search with
  no matches says so.
- The sync status icon, the mobile navigation (all five links fit) and mobile page titles.
- KPI deltas no longer show huge percentages when the previous period was tiny.
- Number and time formats, and "1 requests".
- New roles appear without restarting the dashboard, and an invalid `config.json` is reported.

## [0.2.0] - 2026-11-27

### Added

- Colour system: opus is blue, sonnet is orange and haiku is teal. Roles have their own colours and icons,
  and status, cache hit rate, context level and stop reason are colour coded. The cost column shows a heat marker.
- Icons throughout the dashboard.
- Table toolkit on every table: search, facet filters with counts, grouping with subtotals, column visibility,
  row density, pagination with a page size of 25, 50 or 100, and table state kept in the URL.
- Redesigned Projects, Roles (grouped by tier, with By model and By role tables), Live (context levels)
  and Session detail (request table with filters, plus models, tools and agents panels).
- Search over a session's requests.
- Favicon.
- MIT license.

### Changed

- The Overview chart stacks cost by model family.
- Live refreshes when new data is synced, not every 5 seconds.
- The dashboard `project` filter matches the project exactly, not by substring.
- Database migration v2 adds indexes. A v0.1.0 binary refuses a v2 database with
  `data.db schema v2 is newer than this claude-manager (v1); upgrade the binary`. To downgrade, run
  `sqlite3 ~/.claude-manager/data.db "PRAGMA user_version = 1"` first (use `$CLAUDE_MANAGER_HOME/data.db`
  if you set that variable). The indexes stay in the file and are harmless.

### Fixed

- Mobile title truncation.
- Stale data shown for a moment when switching between sessions.
- Focus ring on the chart.
- Mobile tap targets.

## [0.1.0] - 2026-11-27

### Added

- Role installer: `install` writes six preset role agents (manager, architect, researcher, coder,
  reviewer, writer) to `~/.claude` or `./.claude` (`--scope project`) and maps the opus/sonnet/haiku
  aliases to tier models in `settings.json`. `--dry-run` previews, `--force` backs up files it did not
  create, `--main-agent` sets the main session agent.
- `uninstall` reverts exactly what `install` wrote, keeps files you edited afterwards, and can delete
  local data with `--purge-data`.
- `roles` lists roles and lets you move a role to another tier, pin a model, add or remove custom roles,
  and disable or re-enable presets. Changes apply to every installed scope.
- `tier` shows and changes the model ID behind each tier, so role files stay the same when model
  names change.
- `doctor` checks Claude Code, installs and settings, and exits 1 if any check fails.
- `sync` imports Claude Code transcripts incrementally into a local SQLite database
  (`~/.claude-manager/data.db`). Prompt text can be excluded with `"storePromptText": false`.
- `stats` shows token usage and estimated cost grouped by model, role, project or day, with
  `--since`, `--project`, `--limit` and `--json`. Prices can be overridden in
  `~/.claude-manager/pricing.json`.
- `dashboard` serves a read-only local web dashboard of usage, estimated cost and context use on
  127.0.0.1 (default port 5757, `--port` or `dashboardPort` to change). It runs in production mode,
  with no dev overlay.
- Dashboard look: light and dark themes that follow the OS, plus a toggle.
- Dashboard overview: four KPIs with deltas against the previous period, a daily cost chart stacked
  by model, top projects and sessions, and cost per tier.
- Dashboard sessions: sort, search and project filter are stored in the URL, so views can be shared.
  The page refreshes by itself when new data arrives and shows a "Synced Ns ago" indicator.
- Single-binary releases for macOS and Linux (x64, arm64) with `SHA256SUMS`, an `install.sh`
  installer, and an experimental Windows build.
- `update` replaces the binary with the latest release after verifying its checksum;
  `update --check` only reports whether one is available.

### Changed

- Dashboard errors are clearer and offer a Retry button. Keyboard focus is visible and the layout
  works on mobile.