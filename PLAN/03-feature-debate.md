# PLAN 03 — Debat Fitur

Format: **Pro** vs **Kontra** → **Rekomendasi**. Item bertanda 🟡 = keputusan user dibutuhkan.

---

### D1. Distribusi role: plugin Claude Code vs tulis file langsung
- **Pro plugin:** versioning, `claude plugin validate`, uninstall bersih bawaan.
- **Kontra plugin:** tidak bisa membawa `env`/`agent` (tetap harus menulis settings.json); agent plugin diberi namespace `plugin:x:name` sehingga `claude --agent manager` jadi lebih panjang; plugin mengabaikan `permissionMode`/`hooks` di agent; nama tidak boleh berawalan `claude-`. Akhirnya ada dua mekanisme install sekaligus.
- **Rekomendasi:** **tulis file langsung** ke `.claude/agents/` + manifest. Satu mekanisme. Plugin dipertimbangkan lagi bila nanti perlu skills/hooks dalam jumlah banyak.

### D2. 🟡 Manager sebagai sesi utama: default atau opt-in
- **Pro default (`"agent":"manager"` di settings):** pengalaman swarm langsung aktif.
- **Kontra:** body agent **mengganti seluruh system prompt default** di *setiap* sesi, termasuk saat user hanya ingin edit cepat. Invasif dan mengejutkan.
- **Rekomendasi:** **opt-in.** Default: role ter-install, user menjalankan `claude --agent manager` saat butuh swarm. Flag `install --main-agent manager` untuk yang ingin selalu aktif.

### D3. Pemetaan tier: env alias vs ID penuh di frontmatter
- **Pro env:** ganti model = ubah satu nilai; file agent stabil; ikut otomatis saat alias Anthropic diperbarui.
- **Kontra env:** `ANTHROPIC_DEFAULT_OPUS_MODEL` berlaku global, termasuk sesi utama di luar swarm.
- **Rekomendasi:** **env + alias** sebagai default (memang itu maksud "set per role, nama model bisa berubah"). ID penuh hanya bila user eksplisit `roles set coder claude-sonnet-5-5` (pin per role).

### D4. Seberapa "pintar" deteksi model
- **Pro auto-switch:** user tak perlu tahu nama model baru.
- **Kontra:** alias sudah melakukan itu. Auto-switch diam-diam bisa menaikkan biaya tanpa sadar.
- **Rekomendasi:** **tidak ada auto-switch.** `tier` dan `doctor` membaca model-catalog lokal Claude Code untuk *menampilkan* model tersedia dan memberi tahu bila ada versi baru di family yang sama.

### D5. 🟡 Daftar role preset
- **Pro banyak role (8+):** terasa lengkap.
- **Kontra:** deskripsi tiap agent memakan token di setiap giliran; banyak role = manager lebih sering salah pilih.
- **Rekomendasi: 6 role**:

| Role | Tier | Tools | Catatan |
|---|---|---|---|
| `manager` | think (opus) | Agent, Read, Grep, Glob, Task* | Dilarang Edit/Write; delegasi + override `model` per tugas |
| `architect` | think (opus) | Read, Grep, Glob, WebSearch/Fetch | Desain & plan, read-only |
| `researcher` | basic (haiku) | Read, Grep, Glob, WebSearch/Fetch | "Pembaca", tanpa Agent |
| `coder` | work (sonnet) | semua kecuali Agent | Implementasi |
| `reviewer` | work (sonnet) | Read, Grep, Glob, Bash | Review + jalankan test, tanpa Edit |
| `writer` | basic (haiku) | Read, Edit, Write | Docs/copy, tanpa Bash & Agent |

  `ui-ux` dan `tester` jadi contoh `roles add` di README, bukan preset. Role kustom tetap bisa dibuat kapan saja dengan `roles add`.

### D6. 🟡 Tier `fable` (di atas opus, ~2x harga opus)
- **Pro:** model terkuat untuk keputusan arsitektur berat.
- **Kontra:** mahal; menambah tier keempat ke mental model.
- **Rekomendasi:** tier tetap 3. Fable bisa dipakai via `tier set think claude-fable-5-2` atau `roles set architect fable`.

### D7. Agent teams (swarm eksperimental bawaan)
- **Pro:** shared task list, mailbox antar agent.
- **Kontra:** eksperimental, boros token, tidak bisa bertingkat, mengubah subagent bernama jadi teammate.
- **Rekomendasi:** **di luar v1.** Subagent bertingkat sudah cukup untuk hierarki manager → worker.

### D8. Statusline sebagai kolektor
- **Pro:** satu-satunya sumber `rate_limits` (kuota 5 jam/7 hari) dan cost live resmi.
- **Kontra:** statusline adalah setting personal yang mungkin sudah dipakai user (bentrok); dipanggil sangat sering.
- **Rekomendasi:** **backlog, opt-in** (`install --statusline`). Sisa context & biaya sudah bisa dihitung dari JSONL.

### D9. Realtime: hooks vs polling
- **Pro hooks:** ingest seketika saat `Stop`/`SubagentStop`.
- **Kontra:** menambah entri ke settings.json user; membuat proses tiap event; tetap harus baca JSONL karena hook tidak membawa token.
- **Rekomendasi:** **polling** (`fs.watch` sebagai pemicu + fallback interval) hanya saat dashboard jalan; `sync` manual di luar itu. Tanpa hooks di v1.

### D10. Rekomendasi tier otomatis ("role X boros, turunkan ke sonnet")
- **Pro:** ini pembeda utama dibanding ccusage.
- **Kontra:** butuh data nyata dulu supaya heuristiknya tidak asal.
- **Rekomendasi:** **backlog**, mulai setelah M2 jalan beberapa minggu. Skema DB sudah menyimpan yang dibutuhkan (`agent_type`, model, usage).

### D11. 🟡 Simpan teks prompt
- **Pro:** diminta langsung oleh user (lihat prompt apa yang dipakai).
- **Kontra:** prompt bisa berisi secret/kode internal; DB jadi aset sensitif.
- **Rekomendasi:** **simpan secara default**, lokal saja: DB `chmod 600`, server `127.0.0.1`, opsi `privacy.storePromptText=false`. Tanpa redaksi regex otomatis (heuristik, memberi rasa aman palsu).

### D12. Sumber biaya: hitung sendiri vs `cost-state` Claude Code
- **Rekomendasi:** **hitung sendiri** (bisa per request/role/agent), tampilkan selisih terhadap `cost-state` sebagai indikator akurasi. Label "estimasi"; user Pro/Max melihat "setara harga API".

### D13. Retensi data
- **Rekomendasi:** **simpan selamanya** secara default (nilai utama: history > 30 hari). `prune --older-than` di backlog.

### D14. Teknologi dashboard
- **Pro React:** komponen nyaman.
- **Kontra:** dependency, bundle lebih besar, overkill untuk 5 halaman tabel + grafik.
- **Rekomendasi awal:** HTML import + TypeScript vanilla.
- **Keputusan user:** **React + Tailwind + shadcn/ui**, tetap di-bundle lewat HTML import ke dalam binary.

### D15. 🟡 Port
- User mengusulkan 5000, tapi di macOS port itu dipakai ControlCenter/AirPlay (terverifikasi di mesin ini).
- **Rekomendasi:** default **5757**, `--port` dan `config.json` untuk override, pesan jelas bila port terpakai.

### D16. Command `docs`
- **Rekomendasi:** ganti dengan `help <command>` (detail per command, offline). README untuk dokumentasi panjang. Tidak perlu command `docs` terpisah.

### D17. 🟡 Nama app
- `claude-manager` jelas maksudnya, tapi memakai merek "Claude" dan tidak bisa dipakai sebagai nama plugin (reserved). Bila dipublikasikan, ada risiko soal merek.
- **Opsi:** tetap `claude-manager` (pemakaian pribadi/internal) · `swarmctl` · `cm-swarm` · nama lain.

### D18. 🟡 Platform target v1
- Cross-compile semua target murah, tapi path & `fs.watch` di Windows belum diuji.
- **Rekomendasi:** v1 resmi **macOS + Linux**; Windows dibuild tapi berlabel eksperimental.

### D19. Provider Bedrock/Vertex
- Alias me-resolve ke ID berbeda di provider lain.
- **Rekomendasi:** di luar v1; `doctor` memberi peringatan bila terdeteksi `CLAUDE_CODE_USE_BEDROCK/VERTEX`.

---

## Ringkasan keputusan yang dibutuhkan dari user

| # | Pertanyaan | Rekomendasi |
|---|---|---|
| D2 | Manager selalu aktif sebagai sesi utama? | Opt-in |
| D5 | 6 role preset di atas sudah cocok? | Ya |
| D6 | Tambah tier fable? | Tidak, 3 tier |
| D11 | Simpan teks prompt default? | Ya, lokal |
| D15 | Port default | 5757 |
| D17 | Nama app | Tetap `claude-manager` bila internal |
| D18 | Platform v1 | macOS + Linux |
