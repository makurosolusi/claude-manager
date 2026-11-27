# RND 01 — Mekanisme Subagent, Model, Hierarki & Settings di Claude Code

- **Versi acuan:** Claude Code 2.1.332 (terpasang lokal, `claude --help`)
- **Tanggal riset:** 2026-11-27
- **Sumber:** docs resmi `code.claude.com/docs` (indeks: https://code.claude.com/docs/llms.txt)
- **Legenda:** ✅ = terverifikasi di docs/CLI · ⚠️ = asumsi/belum terverifikasi

---

## 1. Format `.claude/agents/*.md`

Sumber: https://code.claude.com/docs/en/sub-agents

File Markdown + YAML frontmatter; body = system prompt agent. Field camelCase, field tak dikenal **diabaikan diam-diam** ✅.

| Field | Wajib | Nilai / catatan |
|---|---|---|
| `name` | ✅ ya | Identitas agent (bukan nama file). Subfolder discan rekursif |
| `description` | ✅ ya | Dipakai Claude untuk memutuskan kapan delegasi |
| `tools` | – | Allowlist. Mendukung `Agent(worker, researcher)`, `mcp__server__*` |
| `disallowedTools` | – | Denylist |
| `model` | – | `sonnet` · `opus` · `haiku` · `fable` · ID penuh (`claude-opus-5-5`) · `inherit` |
| `permissionMode` | – | `default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan`/`manual` |
| `maxTurns` | – | Batas giliran |
| `autoCompactWindow` | – | ≥100000, v2.1.296+ |
| `skills` | – | Skill yang dimuat |
| `mcpServers` | – | MCP khusus agent |
| `hooks` | – | Hook khusus agent |
| `memory` | – | `user` / `project` / `local` |
| `background` | – | Jalan di background |
| `omitClaudeMd` | – | v2.1.271+ |
| `effort` | – | Level effort |
| `isolation` | – | `worktree` |
| `color` | – | red, blue, green, yellow, purple, orange, pink, cyan |
| `initialPrompt` | – | Hanya dipakai bila agent jadi sesi utama (`--agent`) |
| `experimental.cacheTtl` | – | `5m` / `1h` |

**Lokasi & prioritas** ✅ (nama sama → yang lebih tinggi menang):
managed > `--agents` (JSON CLI) > `.claude/agents/` (project, naik dari cwd) > `~/.claude/agents/` (user) > plugin `agents/`.

- `--agents` JSON memakai field `prompt` (bukan body), mengabaikan `color` & `experimental` ✅.
- Agent plugin diberi namespace `plugin:sub:name` dan **mengabaikan** `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` ✅.

---

## 2. Alias model, env override & precedence

Sumber: https://code.claude.com/docs/en/model-config

### Alias ✅
| Alias | Resolve (Anthropic API) |
|---|---|
| `opus` / `best` | Opus 5.5 |
| `sonnet` | Sonnet 5.5 |
| `haiku` | Haiku 5.5 |
| `fable` | Fable 5.2 |
| `sonnet[1m]`, `opus[1m]` | varian context 1M (perlu hanya utk model lama 4.6) |
| `opusplan` / `opusplan[1m]` | Opus saat plan mode, Sonnet saat eksekusi |
| `default` | default akun |

Bedrock/Vertex me-resolve alias ke ID berbeda (mis. Sonnet 4.5/Haiku 4.5) ✅. Context 1M default untuk Fable, Sonnet 5+, Haiku 5.5, Opus 4.7+; Haiku 5.5 lebih mahal di prompt >100K ✅.

### Env override ✅
| Env | Fungsi |
|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_MODEL` / `_HAIKU_MODEL` / `_FABLE_MODEL` | Ubah target resolve alias → **kunci untuk "nama model berubah, user cukup set per tier"** |
| `ANTHROPIC_MODEL` | Model sesi utama |
| `ANTHROPIC_DEFAULT_MODEL` | Default terendah (v2.1.236+) |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model default subagent (tidak mengubah built-in Explore/Plan) |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` | Paksa semua subagent/teammate ke satu model (v2.1.257+) |

### Precedence sesi utama ✅
`/model` > `--model` > `ANTHROPIC_MODEL` > settings `model` > `ANTHROPIC_DEFAULT_MODEL`.
Catatan: `/model` **menulis ke user settings**; `model` & `effortLevel` dibaca hanya saat sesi mulai.

### Precedence model subagent ✅
1. Parameter `model` per-panggilan tool Agent (alias saja)
2. Frontmatter `model`
3. `CLAUDE_CODE_SUBAGENT_MODEL`
4. Model parent

Alias satu-family mengikuti versi parent (parent di versi opus tertentu → `model: opus` pakai versi itu). Allowlist managed: `availableModels`, `deniedModels`, `enforceAvailableModels`.

---

## 3. Nested subagent & sesi utama sebagai agent

Sumber: https://code.claude.com/docs/en/sub-agents, `claude --help`

| Aspek | Fakta ✅ |
|---|---|
| Nesting | **Boleh**: default subagent bisa spawn hingga 3 lapis di bawah sesi utama. `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (=1 mematikan nesting) |
| Blok spawn per agent | Hilangkan `Agent` dari `tools` atau masukkan ke `disallowedTools` |
| Allowlist `Agent(type,...)` | Hanya berlaku di main thread via `--agent`; di dalam subagent diabaikan |
| Konkurensi | Maks 20 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) |
| Sesi utama = agent | `claude --agent <name>` atau setting `{"agent": "<name>"}`; flag menang atas setting |
| Efek `--agent` | Main thread memakai tools/model agent; **body agent menggantikan seluruh system prompt default**; CLAUDE.md tetap dimuat; persist saat resume |
| `--agents <json\|file>` | Definisi agent ad-hoc per sesi |
| Output styles | Ada (`output-styles/`), tapi untuk persona penuh `--agent` lebih tepat ⚠️ (tidak didalami) |

---

## 4. Plugin, agent teams, hooks, statusline

### 4a. Plugin sebagai distribusi preset ✅
Sumber: https://code.claude.com/docs/en/plugins/overview, https://code.claude.com/docs/en/plugins/manifest-reference

- Struktur: `.claude-plugin/plugin.json` (**opsional**; hanya `name` wajib bila ada) + `agents/`, `skills/`, `hooks/hooks.json`, `.mcp.json`, `output-styles/`, `workflows/`, `bin/` (masuk PATH Bash tool), `experimental.monitors`.
- Field manifest penting: `version` (pin), `engines.claude-code` (semver, v2.1.323+), `dependencies`, `defaultEnabled`, `userConfig` (prompt nilai, `sensitive` → secure storage).
- Variabel: `${CLAUDE_PLUGIN_ROOT}` (berubah tiap update, jangan simpan state), `${CLAUDE_PLUGIN_DATA}` = `~/.claude/plugins/data/<id>/` (persist; dihapus saat uninstall terakhir kecuali `--keep-data`).
- Install: marketplace (`.claude-plugin/marketplace.json`) → `/plugin install x@market` / `claude plugin install`; dev: `--plugin-dir`; cek: `claude plugin validate [--strict]`.
- Nama berawalan `claude-`/`anthropic-`/`cc-plugin-` = **error reserved** → jangan namai plugin `claude-manager`; pakai mis. `smart-model` ✅.
- **Plugin TIDAK bisa membawa settings.json / key `agent` / `env` / `model`** — tidak ada field itu di manifest (top-level tak dikenal di-strip) ✅. Jadi tiering via env & `agent` default tetap butuh tulis ke settings.json.
- Biaya: deskripsi agent & skill setiap plugin aktif memakan token tiap giliran ✅.

### 4b. Agent teams (swarm bawaan) ✅
Sumber: https://code.claude.com/docs/en/agent-teams

- **Eksperimental**, aktifkan `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Butuh sesi interaktif (tidak di `-p`/SDK).
- Lead (sesi utama) + teammate (instance terpisah), shared task list, mailbox `~/.claude/teams/{team}/inboxes/*.json`, task di `~/.claude/tasks/{team}/`.
- Teammate bisa memakai definisi `.claude/agents/` (tools, model, body diterapkan; `skills` tidak).
- Urutan model teammate: model di prompt spawn > `model` definisi > `CLAUDE_CODE_SUBAGENT_MODEL` > model lead. `teammateDefaultModel` dihapus v2.1.234.
- Batasan: tak ada nested team, satu team per sesi, lead tetap, resume tidak memulihkan teammate in-process, permission mode teammate = mode lead.
- Efek samping: bila aktif, subagent yang diberi nama oleh Claude jadi teammate otomatis.
- Hook kualitas: `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit 2 = tolak + feedback).

### 4c. Hooks relevan ✅
Sumber: https://code.claude.com/docs/en/hooks

- 34 event, a.l. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `SessionEnd`.
- Field umum: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `agent_id`, `agent_type`.
- `SubagentStop`: + `agent_transcript_path` (`.../<session>/subagents/agent-<id>.jsonl`), `last_assistant_message`.
- `model` hanya (kadang) di `SessionStart`; tidak ada `$CLAUDE_MODEL`.
- **Hook tidak membawa token/biaya kumulatif.** `PostToolUse` untuk tool Agent (foreground) membawa `tool_response.resolvedModel`, `modelsUsed`, `totalTokens`, `usage`, `totalDurationMs`, `totalToolUseCount` — tapi hanya **request terakhir**, bukan total run. Untuk rollup resmi docs menunjuk counter OpenTelemetry (`query_source="subagent"`, https://code.claude.com/docs/en/monitoring-usage) ⚠️ belum didalami.
- Sumber data paling lengkap untuk analytics = parsing transcript JSONL (`transcript_path` + `agent_transcript_path`) ⚠️ (format JSONL internal, bisa berubah; ditulis async/bisa lag).

### 4d. Statusline ✅
Sumber: https://code.claude.com/docs/en/statusline

Setting: `{"statusLine": {"type": "command", "command": "...", "padding": 0, "refreshInterval": N}}`. JSON stdin memuat:

| Field | Isi |
|---|---|
| `session_id`, `session_name`, `prompt_id`, `transcript_path`, `cwd` | identitas sesi |
| `model.id`, `model.display_name` | model aktif |
| `workspace.current_dir`, `project_dir`, `repo` | grouping project |
| `cost.total_cost_usd`, `total_duration_ms`, `total_lines_added/removed` | biaya sesi |
| `context_window.total_input_tokens`, `total_output_tokens`, `context_window_size`, `used_percentage`, `remaining_percentage`, `current_usage{...}` | **sisa context** |
| `prompt_cache.*`, `rate_limits.*`, `effort.level`, `agent.name` | cache, kuota, agent (`--agent`) |

→ Statusline adalah satu-satunya titik resmi yang memberi **cost + sisa context** secara live; cocok jadi kolektor data (tulis ke SQLite) selain menampilkan.

---

## 5. Lokasi & merge semantics settings.json ✅

Sumber: https://code.claude.com/docs/en/settings

| Scope | File |
|---|---|
| User | `~/.claude/settings.json` (pindah via `CLAUDE_CONFIG_DIR`) |
| Project (dibagi, di-commit) | `.claude/settings.json` |
| Local (pribadi) | `.claude/settings.local.json` |
| Managed | lokasi OS / server-managed |

- **Precedence:** managed > `--settings` > local > project > user.
- **Merge:** key array (mis. `permissions.allow`) **digabung** lintas scope; pengecualian `fallbackModel`, `modelPicker`, `availableModels`, `modelSettings`. Blok `env` ikut precedence biasa.
- JSON **strict** (tanpa komentar/trailing comma). Schema: https://json.schemastore.org/claude-code-settings.json.
- Hot-reload kecuali `model` & `effortLevel`. Diagnosa: `claude doctor`, `/status`.

---

## Implikasi desain untuk `claude-manager`

1. **Tiering via alias, bukan ID.** Frontmatter agent pakai `opus`/`sonnet`/`haiku`; pemetaan tier → model nyata ditaruh di `env.ANTHROPIC_DEFAULT_*_MODEL` settings.json. Ganti model = ubah satu nilai, tanpa menyentuh file agent. Override darurat global: `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`.
2. **Manager = sesi utama.** `claude --agent manager` atau `{"agent":"manager"}`; tools manager tanpa `Edit`/`Write`/`NotebookEdit`, pakai `Agent(reader, writer, ...)` sebagai allowlist delegasi. Worker daun: tanpa `Agent` agar tak spawn liar. Nesting 3 lapis cukup untuk manager → lead → worker.
3. **Distribusi:** hybrid. Agent + hooks + statusline collector bisa dikemas jadi plugin (versi, validate, uninstall bersih), tapi env tiering & `agent` default **harus** ditulis ke settings.json karena plugin tak bisa membawanya. Jangan beri nama plugin berawalan `claude-`.
4. **Installer wajib merge, bukan overwrite** settings.json (strict JSON, array ter-concat), simpan manifest file/key yang ditambahkan + backup → `uninstall` bisa revert presisi.
5. **Sumber log analytics:** statusline (cost, context, model, project per sesi) + hooks `UserPromptSubmit`/`SubagentStart`/`SubagentStop`/`PostToolUse(Agent)` (prompt, agent, timing) + parsing transcript JSONL untuk token per-request. Biaya per subagent tidak tersedia langsung → estimasi dari usage × tabel harga (perlu RND harga terpisah). Pertimbangkan OTel sebagai alternatif ⚠️.
6. **Agent teams jangan jadi default** (eksperimental, boros token, efek samping subagent bernama → teammate). Jadikan opsi.
