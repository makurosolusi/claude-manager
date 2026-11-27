# RND 03 — Bun: Single Binary, SQLite, Dashboard, Distribusi

Tanggal: 2026-11-27 · Bun terpasang: **1.4.2** (terbaru di bun.com: **1.4.5**) · Mesin: macOS arm64 (Darwin 24.5)

Legenda: ✅ terverifikasi eksperimen lokal · 📄 terverifikasi docs · ❓ dugaan, belum diuji

---

## 1. `bun build --compile`

### Hasil eksperimen (prototipe: CLI + bun:sqlite + HTML import + Bun.serve)

| Item | Hasil |
|---|---|
| Ukuran `darwin-arm64` (`--minify`) | ✅ **62,2 MB** |
| `darwin-x64` / `linux-x64` / `linux-arm64` / `windows-x64` | ✅ 69,3 / 81,3 / 81,3 / 86,1 MB — semua cross-compile dari mac **berhasil** |
| `linux-x64-musl` | ✅ build OK |
| Waktu compile | ✅ ~0,2 dtk |
| Startup `cm -v` | ✅ **11,1 ms** biasa · **9,4 ms** dengan `--bytecode` (rata-rata 20 run) |
| HTML import + `Bun.serve({ routes })` dalam binary | ✅ **Bekerja**, dijalankan dari `cwd=/`: `/` → HTML, chunk `.css`/`.js` → 200 dengan MIME benar. Aset di `/$bunfs/root/…` |
| `bun:sqlite` dalam binary | ✅ Bekerja (lihat §2) |
| Signature macOS | ✅ `Signature=adhoc`, `flags=adhoc,linker-signed` otomatis — langsung bisa dijalankan di arm64 |
| `--trim` (1.4.2) | ✅ Flag diterima, **ukuran tidak berubah** (62,2 MB) → belum efektif di 1.4.2 |
| `bun compile` (AOT) | ✅ **Belum ada di 1.4.2** (`Script not found "compile"`). 📄 Ada di docs main (experimental) |

Target valid 📄: `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`, `bun-windows-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`, `bun-linux-x64-musl`, `bun-linux-arm64-musl`.

### Temuan penting

- ✅ **`--bytecode` + top-level await di frontend gagal** pada format default (`Expected ";" but found ")"`). Fix: `--format=esm` (📄 bytecode mendukung cjs & esm dengan `--compile`) atau hindari TLA.
- ✅ **BAHAYA: binary compile secara default memuat `.env` dan `bunfig.toml` dari cwd.** Eksperimen: `.env` berisi `X=leak` di cwd → binary membaca `X=leak`. Untuk CLI yang dijalankan di folder project user, ini artinya env project user bisa bocor masuk/mengubah perilaku. **Wajib build dengan** `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (✅ terbukti: `X=undefined`).
- ✅ Error yang tidak tertangkap mencetak **potongan source minified** ke terminal → entrypoint wajib `try/catch` top-level dengan pesan bersih.
- 📄 `--sourcemap` embed sourcemap zstd agar stack trace terbaca. 📄 `--bytecode-order` (PGO) untuk startup lebih cepat — tidak perlu, 11 ms sudah cukup.
- 📄 `--compile-exec-argv`, `BUN_BE_BUN=1` (binary bertindak sebagai `bun`), `--windows-*` opsi tersedia.
- 📄 Codesign untuk distribusi publik (hilangkan Gatekeeper warning saat download via browser): `codesign --deep --force -vvvv --sign "<ID>" ./bin` + `--entitlements` bila perlu JIT. ❓ Download via `curl` tidak memberi atribut `com.apple.quarantine`, jadi install script curl tidak kena Gatekeeper; download dari browser kena.

Sumber: https://github.com/oven-sh/bun/blob/main/docs/compiler/executables.mdx · https://github.com/oven-sh/bun/blob/main/docs/compiler/size.mdx (halaman bun.com/docs/bundler/executables kini 404; docs pindah ke `docs/compiler/`).

---

## 2. `bun:sqlite`

| Item | Hasil |
|---|---|
| `PRAGMA journal_mode=WAL` | ✅ aktif (`journal_mode: "wal"`), juga di dalam binary |
| 100.000 insert, 1 transaksi + prepared statement | ✅ **77–87 ms** (dalam compiled binary) |
| `db.transaction(fn)` | ✅ API native, rollback otomatis bila throw |

Implikasi:
- Bottleneck ingest **bukan** SQLite, melainkan membaca/parse JSONL (§4).
- ❓ Dua proses (CLI `sync` + dashboard) menulis bersamaan → pakai WAL + `PRAGMA busy_timeout=5000`. Lebih sederhana: hanya satu penulis (dashboard yang sync; CLI `sync` menolak/menunggu jika dashboard jalan) — belum diuji.
- 📄 `with { type: "sqlite", embed: "true" }` bisa embed DB read-only ke binary (tidak dibutuhkan; DB user ada di `~/.claude-manager/`).

Sumber: https://bun.com/docs/runtime/sqlite.md (tercantum di https://bun.com/docs/llms.txt)

---

## 3. Arg parsing — `util.parseArgs`

- ✅ Bekerja dalam binary. `strict: true` melempar `TypeError: Unknown option '--bad'…` (harus ditangkap, lihat §1).
- Tidak ada konsep subcommand native. Pola cukup (tanpa dependency):
  1. `const [cmd, ...rest] = Bun.argv.slice(2)`
  2. `switch (cmd)` → tiap command memanggil `parseArgs({ args: rest, options: {...per-command} })`
  3. Global flag (`-v/--version`, `-h/--help`) dicek sebelum dispatch.
- Help text ditulis manual (string template) — untuk ≤10 command ini lebih ringkas daripada library.
- Kesimpulan: **tidak perlu commander/yargs/citty.**

---

## 4. Tail JSONL incremental — `fs.watch` + `Bun.file().slice()`

Eksperimen ✅:
- `fs.watch(dir, { recursive: true })` di macOS menangkap file baru di subfolder baru (`sub/a.jsonl`).
- **Semua event berupa `rename`**, termasuk saat append (perilaku FSEvents) → jangan percaya jenis event; anggap event = "cek ulang ukuran file".
- Baca dari offset: `Bun.file(f).slice(offset, size).text()` → potong sampai `\n` terakhir, simpan offset → **baris parsial (ditulis setengah) aman**, dibaca di event berikutnya. Teruji dengan karakter multibyte (`ü`).
- ❓ Linux `recursive` belum diuji (📄 Bun mendukung). Fallback aman: polling tiap N detik (bandingkan `size`/`mtime`) — lebih sederhana dan cukup untuk dashboard.
- Saran: hitung offset dalam **byte** (cari byte `0x0A` di `Uint8Array`), bukan panjang string, agar boundary UTF-8 tidak meleset.

### Volume data nyata mesin ini (hanya ukuran, isi tidak dibaca)

| Item | Nilai |
|---|---|
| `~/.claude/projects` | ✅ **5,6 GB**, **2.961** file `.jsonl` |
| Satu file terbesar yang diuji | ✅ 141,8 MB, 33.283 baris, `JSON.parse` semua: **537 ms** (~260 MB/s), 0 baris rusak |

Implikasi desain:
- **Initial sync ~20–30 dtk** untuk 5,6 GB (estimasi dari throughput parse) ❓ → butuh progress bar + incremental state per file (`path, size, mtime, offset`).
- **Jangan `.text()` file utuh** untuk file 100+ MB → baca per chunk (`slice` bertahap, mis. 8 MB) agar memori stabil.
- Simpan **hanya field yang dibutuhkan** (usage, model, ts, cwd, session, agent, potongan prompt), bukan baris mentah → DB jauh lebih kecil dari 5,6 GB.

---

## 5. Distribusi

| Kanal | Cara | Catatan |
|---|---|---|
| **GitHub Releases** | CI matrix `bun build --compile --target=…` → upload binary + `SHA256SUMS` | ✅ cross-compile dari 1 runner (mac) terbukti; bisa juga 1 runner ubuntu |
| **Install script** | `curl -fsSL …/install.sh \| sh` → deteksi `uname -s/-m`, unduh asset, verifikasi sha256, taruh di `~/.local/bin` | Pola sama dengan installer native Claude Code (`~/.local/bin/claude` di mesin ini) |
| **Homebrew tap** | formula `url`+`sha256` per arch | Opsional, setelah ada user |
| **npm / `bunx`** | ❓ Paket berisi source TS → `bunx claude-manager` (butuh Bun terpasang). Alternatif pola esbuild: `optionalDependencies` per-platform berisi binary | Tunda; binary + install script cukup untuk v1 |
| **Self-update** | `claude-manager update`: cek release terbaru → unduh ke temp → verifikasi sha256 → `rename` atomik menimpa `process.execPath` | ❓ Windows tidak bisa menimpa exe yang sedang jalan (rename lama → `.old`) |

Ukuran ~62–86 MB per binary: wajar untuk Bun (runtime ikut). Tidak bisa diperkecil di 1.4.2 (`--trim` no-op). 📄 Bun ≥1.4.5 `bun compile --trim` (experimental) mungkin memperkecil — evaluasi nanti, **jangan andalkan**.

---

## 6. Test runner

- `bun test` built-in, Jest-compatible (📄 https://bun.com/docs/test/index.md). Tanpa dependency tambahan.
- 📄 Catatan dari docs `--trim`: `bun test` menjalankan source, bukan binary → tambahkan **1 smoke test yang menjalankan binary hasil build** (`-v`, `--help`, `sync` ke fixture) di CI.

---

## 7. Port 5000 di macOS

✅ Terkonfirmasi lokal:
```
ControlCe 590 bip TCP *:5000 (LISTEN)   # IPv4 & IPv6
```
ControlCenter (AirPlay Receiver) memakai `*:5000`. **Default port 5000 akan bentrok** di macOS modern. Rekomendasi: default lain (mis. `5757`), `--port` override, dan bila port terpakai tampilkan pesan jelas + saran port.

Bind ke `127.0.0.1` (✅ dipakai di eksperimen) — jangan `0.0.0.0`.

---

## Ringkasan implikasi desain

1. Satu binary = CLI + sqlite + dashboard (HTML import) **terbukti jalan**, startup ~10 ms, ukuran ~62 MB (arm64).
2. Build flags wajib: `--compile --minify --no-compile-autoload-dotenv --no-compile-autoload-bunfig` (+ opsional `--sourcemap`, `--bytecode --format=esm`).
3. Entrypoint: tangkap semua error → pesan bersih + exit code ≠ 0.
4. Arg parsing: `util.parseArgs` + `switch` manual, tanpa dependency.
5. Ingest: state per file (offset byte), baca chunked, simpan field ringkas; watch = trigger "cek ukuran", fallback polling.
6. Port default ≠ 5000; bind `127.0.0.1`.
7. Distribusi v1: GitHub Releases + `install.sh` (sha256) + `update` command. npm/brew ditunda.
8. Pertimbangkan pin/upgrade ke Bun 1.4.5 di CI (versi terbaru) — `bun compile`/`--trim` masih experimental.
