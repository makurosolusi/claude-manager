# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  127.0.0.1 (default port 5757, `--port` or `dashboardPort` to change), refreshing every 5s.
- Single-binary releases for macOS and Linux (x64, arm64) with `SHA256SUMS`, an `install.sh`
  installer, and an experimental Windows build.
- `update` replaces the binary with the latest release after verifying its checksum;
  `update --check` only reports whether one is available.
