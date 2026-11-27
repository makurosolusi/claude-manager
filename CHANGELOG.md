# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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