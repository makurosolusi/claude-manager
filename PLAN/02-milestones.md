# PLAN 02 — Milestone Implementasi

Setiap milestone: branch sendiri (`feature/<m>`), test `bun test` ditulis bersama kode, lapor lalu tunggu approve sebelum merge. Test yang menyentuh `~/.claude` memakai `HOME` sementara (temp dir), tidak pernah HOME asli.

## M0 — Kerangka (kecil)
- `git init`, `bun init`, `.gitignore`, struktur `src/`.
- `cli.ts`: dispatch, `-v`, `-h`, error top-level bersih, exit code.
- `scripts/build.ts`: compile untuk target lokal dengan flag wajib.
- **Test:** unit dispatch + smoke test binary hasil build (`-v`, `--help`, command tak dikenal → exit 1).

## M1 — Role & installer (inti nilai pertama)
- Preset role (lihat PLAN/03 keputusan D5) + render frontmatter.
- `settings.merge`: merge `env.ANTHROPIC_DEFAULT_*_MODEL` (dan `agent` bila `--main-agent`), backup, manifest.
- `install`, `uninstall`, `roles`, `tier`, `doctor` (bagian install).
- **Test:** install→uninstall mengembalikan settings.json byte-identik; agent buatan user dengan nama lain tidak tersentuh; konflik nama agent → ditolak tanpa `--force`; `--dry-run` tidak menulis apa pun.
- **Verifikasi manual:** `claude --agent manager` di sesi nyata, cek manager tidak bisa Edit/Write.

## M2 — Ingest & stats CLI
- Skema SQLite + migrasi berversi (`PRAGMA user_version`).
- Scanner incremental (offset byte, chunk 8 MB), parser whitelist, dedupe `message_id`, atribusi agent via `meta.json`.
- Pricing service + `recompute`.
- `sync`, `stats`.
- **Test:** fixture JSONL sintetis (bukan log asli): dedupe salinan streaming, atribusi subagent, baris parsial di akhir file, tipe tak dikenal, Haiku >100k, cache 5m vs 1h, `<synthetic>` di-skip. Rekonsiliasi terhadap `cost-state` di fixture.
- **Ukur:** waktu initial sync di 5,6 GB lokal (target < 60 dtk).

## M3 — Dashboard
- `Bun.serve` 127.0.0.1:5757, API JSON paginated: `/api/overview`, `/api/projects`, `/api/sessions`, `/api/sessions/:id`, `/api/roles`, `/api/live`.
- Halaman: Overview · Projects · Sessions (drill-down prompt → request → subagent tree) · Roles · Live (sisa context sesi aktif).
- Polling ingest tiap N detik saat dashboard jalan (satu penulis DB).
- **Test:** endpoint (status, paginasi, 404); smoke binary serve + curl.

## M4 — Distribusi
- GitHub Actions: matrix target, `SHA256SUMS`, release.
- `install.sh` (deteksi OS/arch, verifikasi sha256, `~/.local/bin`).
- `update` command.
- `CHANGELOG.md`, README (install, command, privasi).

## Backlog (setelah data nyata terkumpul)
- Rekomendasi tier per role (D10).
- Statusline collector opsional (D8).
- `prune --older-than`, export CSV/JSON.
- Homebrew tap, npm.
