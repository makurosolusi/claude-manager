# PLAN 01 — Produk & Arsitektur

Dasar: `RND/01` (agent/model), `RND/02` (log/analitik), `RND/03` (Bun). Status: **draft, menunggu keputusan di `PLAN/03-feature-debate.md`**.

## 1. Positioning (satu kalimat)

Single binary yang **memasang swarm role ber-tier model** ke Claude Code, lalu **mengukur biaya & perilaku tiap role** dari log Claude Code sendiri, dengan history yang bertahan lebih dari 30 hari.

Pembeda dibanding tool yang sudah ada (ccusage dkk.): atribusi biaya per **role/agent** + rekomendasi tier. Laporan daily/monthly generik sengaja dibuat sederhana karena ccusage sudah matang di sana.

## 2. Konsep inti

```
Role (manager, reader, coder, ...)  ──>  Tier (think / work / basic)  ──>  Alias (opus / sonnet / haiku)  ──>  Model ID
   file .claude/agents/<role>.md          config claude-manager             frontmatter `model:`          env ANTHROPIC_DEFAULT_*_MODEL
```

- **Nama model berubah** → cukup ubah alias→ID (`tier set`), file agent tidak disentuh.
- **Ganti model on the fly per tugas** → sudah native (parameter `model` di tool Agent). Manager diberi instruksi kapan harus override.
- **Larangan menulis code** → ditegakkan oleh `tools` (tanpa `Edit`/`Write`/`NotebookEdit`), bukan cuma prompt.
- **Hierarki** → native sampai 3 lapis (manager → lead → worker). Worker daun tidak diberi tool `Agent`.

## 3. Arsitektur modul

```
src/
  cli.ts                      # entry: parse global flag, dispatch, try/catch top-level
  commands/<cmd>.command.ts   # satu file per command
  roles/roles.presets.ts      # definisi role bawaan (embedded)
  roles/roles.render.ts       # role -> markdown frontmatter
  install/settings.merge.ts   # merge/unmerge settings.json (strict JSON)
  install/install.manifest.ts # catat file & key yang ditulis + backup
  ingest/ingest.scanner.ts    # cari file, state offset per file
  ingest/ingest.parser.ts     # JSONL -> record (whitelist tipe, toleran)
  ingest/pricing.service.ts   # tarif + rumus biaya
  db/db.schema.ts             # DDL + migrasi
  db/db.repository.ts         # query agregasi (paginated)
  server/dashboard.server.ts  # Bun.serve 127.0.0.1, API JSON
  web/index.html (+ .ts/.css) # dashboard, di-bundle via HTML import
```

## 4. Data & lokasi file

| Path | Isi |
|---|---|
| `~/.claude-manager/data.db` | SQLite (WAL, chmod 600) |
| `~/.claude-manager/config.json` | tier→model, port, opsi privasi, role kustom |
| `~/.claude-manager/pricing.json` | override tarif (opsional) |
| `~/.claude-manager/manifest.json` | apa saja yang di-install (path file, key settings, hash) |
| `~/.claude-manager/backups/` | salinan settings.json sebelum diubah |
| `~/.claude/agents/<role>.md` atau `.claude/agents/` | file role (scope user/project) |

Skema DB mengikuti `RND/02` §Implikasi: `files`, `sessions`, `agents`, `requests` (PK `message_id`, dedupe), `prompts`, `tool_calls`, `compactions`.

## 5. Command (draft, final setelah debat)

| Command | Fungsi |
|---|---|
| `install [--scope user\|project] [--preset swarm] [--main-agent manager] [--dry-run]` | Tulis role + merge env tier ke settings.json, simpan manifest |
| `uninstall [--scope] [--purge-data]` | Revert presisi dari manifest; agent buatan user tidak disentuh |
| `roles` / `roles set <role> <tier\|model-id>` / `roles add <name> --tier --tools` / `roles rm <name>` | Kelola role, termasuk role kustom |
| `tier` / `tier set <think\|work\|basic> <model-id>` | Ubah alias→model, saran dari model-catalog lokal |
| `sync` | Ingest JSONL incremental ke SQLite |
| `stats [--project] [--since 7d] [--by role\|model\|project] [--json]` | Ringkasan terminal |
| `dashboard [--port 5757]` | Sync, lalu serve UI + polling |
| `doctor` | Cek claude terpasang/versi, konflik nama agent, settings valid, port, baris log gagal parse |
| `update` | Self-update dari GitHub Releases (sha256) |
| `-v/--version`, `-h/--help`, `help <cmd>` | Standar |

## 6. Prinsip non-fungsional

- Tanpa dependency runtime: `util.parseArgs`, `bun:sqlite`, `Bun.serve`, HTML import.
- Build: `--compile --minify --no-compile-autoload-dotenv --no-compile-autoload-bunfig` (lihat RND/03 §1: tanpa flag ini `.env` milik project user ikut terbaca).
- Server hanya `127.0.0.1`; semua endpoint list ter-paginasi.
- Parser log toleran: tipe tak dikenal di-skip dan dihitung, tidak pernah crash.
- Tarif & context window dari config (urutan: override user → cache Claude Code lokal → default bawaan), setiap biaya menyimpan `pricing_version`.
