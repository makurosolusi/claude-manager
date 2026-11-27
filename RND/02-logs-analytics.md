# RND 02 — Data Log Claude Code untuk Analitik

Tanggal riset: 2026-11-27 · Claude Code lokal: `2.1.332` · Sampel: 60 file JSONL terbaru + 638 file (7 hari terakhir) untuk uji duplikasi.
Legenda: ✅ terverifikasi (inspeksi lokal / docs resmi) · ⚠️ dugaan / perlu cek ulang.
Catatan privasi: inspeksi hanya membaca *keys/tipe/angka*, tidak membaca isi prompt.

---

## 1. Layout file transcript ✅

```
~/.claude/projects/
  <cwd-di-encode>/                         # "/" dan "." → "-", mis. -Users-bip-Documents-makuro-solusi-claude-smart-model
    <sessionId>.jsonl                      # transcript sesi utama
    <sessionId>/
      subagents/
        agent-<agentId>.jsonl              # transcript tiap subagent (isSidechain=true, punya agentId)
        agent-<agentId>.meta.json          # metadata subagent
      tool-results/<toolUseId>.txt         # output tool besar yang di-persist
    memory/                                # auto-memory (bukan log)
```

- Nama folder project **lossy** (`/` dan `-` sama-sama jadi `-`), jadi project harus diambil dari field `cwd` di entri, bukan dari nama folder. ✅
- `agent-*.meta.json` berisi: `agentType` (= subagent_type, mis. `fork`, `web-fetch`, `Explore`), `name`, `description`, `toolUseId` (link ke tool_use `Agent` di parent), `spawnDepth`, `model` (`inherit`/id), `pickedEffortModel`, `isFork`, `isBuiltIn`, `requestShape` (`background`/`foreground`), `finished`. ✅ **Ini sumber atribusi agent termudah.**
- Retensi: Claude Code **menghapus transcript setelah 30 hari** (default `cleanupPeriodDays`). ✅ → alasan kuat app kita menyimpan ke SQLite sendiri (history > 30 hari).

## 2. Tipe entri JSONL ✅

Distribusi dari 60 file (v2.1.306–2.1.332):

| `type` | Jumlah | Guna untuk analitik |
|---|---|---|
| `assistant` | 19.310 | **Inti**: model, usage, tool_use, stop_reason |
| `user` | 10.935 | Prompt user **dan** tool_result (harus dibedakan) |
| `system` | 4.416 | subtype: `turn_duration`, `compact_boundary`, `stop_hook_summary`, `away_summary`, `informational`, `agents_killed` |
| `cost-state` | 174 | **Biaya kumulatif sesi yang dihitung Claude Code sendiri** (lihat §4) |
| `ai-title` | 4.734 | Judul sesi otomatis (pengganti `summary` versi lama) |
| `last-prompt`, `mode`, `permission-mode`, `tools-used`, `pr-link`, `queue-operation`, `session-owner` | — | Metadata sesi (opsional) |
| `attachment`, `api-request*`, `data-flow-*`, `atis-latch`, `file-history-*`, `derived-from` | — | Internal, **skip** |

> ⚠️ Format ini internal & tidak didokumentasikan; tipe baru muncul tiap versi. Parser wajib whitelist tipe yang dipakai dan mengabaikan sisanya.

### Field umum (entri `user`/`assistant`/`system`) ✅

`uuid`, `parentUuid`, `logicalParentUuid` (setelah compact), `sessionId`, `timestamp` (ISO-8601 UTC), `cwd`, `gitBranch`, `version`, `entrypoint` (`cli`/sdk), `userType`, `isSidechain`, `agentId` (hanya di subagent), `attributionAgent`, `isMeta`.

### Entri `assistant` ✅

- `message`: `id` (msg_…), `model` (**model yang benar-benar melayani**), `role`, `content[]`, `stop_reason`, `usage`.
- Top-level: `requestId`, `requestedModel`, `effort` (`low…max`), `perTurnEffort`, `madeBy`, `thinkingDurationMs`, `apiBlockIndex`.
- `requestedModel` **sering ≠** `message.model` (mis. requested `claude-opus-4-6` → served `claude-sonnet-5-5`, 3.841 kasus). **Harga & atribusi harus pakai `message.model`.** ✅
- `message.model == "<synthetic>"` (21 kasus, usage null) = pesan buatan harness → skip. ✅

### `message.usage` — semua subfield ✅

```json
{
  "input_tokens": 4,
  "cache_creation_input_tokens": 89239,
  "cache_read_input_tokens": 0,
  "output_tokens": 2461,
  "output_tokens_details": { "thinking_tokens": 1070 },
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
  "service_tier": "standard",
  "cache_creation": { "ephemeral_5m_input_tokens": 89239, "ephemeral_1h_input_tokens": 0 },
  "inference_geo": "global",          // "global" | "not_available" | ("us" → 1.1x)
  "speed": "standard",                 // "fast" → tarif fast mode
  "iterations": [],
  "fallback_credit": null
}
```

Split `cache_creation.ephemeral_5m` vs `ephemeral_1h` **penting**: tarif write 1.25x vs 2x.

### Entri `user` — membedakan prompt asli ✅

| Pola | Arti |
|---|---|
| `content` = array berisi `tool_result` + `toolUseResult` ada | hasil tool (bukan prompt) — 8.422 |
| `origin.kind=="human"`, `promptSource` ∈ `typed`/`suggestion_accepted` | **prompt user asli** |
| `turnOrigin=="task_notification"` | notifikasi task/subagent |
| `promptSource=="sdk"` | prompt dari SDK |
| `isMeta==true` | injeksi sistem (skill, reminder) — skip |

`promptId` menghubungkan entri dengan prompt (sama dengan `prompt_id` di hook / OTel). ✅

### Atribusi subagent ✅

Tiga jalur, dari yang termudah:

1. **`subagents/agent-<id>.meta.json`** → `agentType`, `name`, `toolUseId`, `spawnDepth`.
2. Parent `assistant.content[]` `tool_use` dengan `name=="Agent"` → `input.subagent_type`, `input.model` (override on the fly), `input.description`.
3. Parent `user.toolUseResult` → `{status, agentId, agentType, resolvedModel, totalTokens, totalDurationMs, totalToolUseCount, toolsUsed, usage}`.

> ⚠️ **Jangan menjumlah `toolUseResult.usage`/`totalTokens` ke biaya.** Itu ringkasan. Token per-request subagent sudah ada di `agent-*.jsonl`, jadi dobel hitung jika dijumlah. Pakai hanya untuk cross-check.

### Duplikasi entri streaming ✅ (penting)

- Satu respons API ditulis sebagai **beberapa entri `assistant`** (satu per content block: thinking / text / tool_use), dengan `message.id` + `requestId` sama dan **`usage` identik di setiap salinan**.
- Ukuran: 53.087 entri assistant → **27.887 `message.id` unik** (~1,9x). Tanpa dedupe, token & biaya **hampir dobel**.
- Lintas file: 27 `message.id` muncul di >1 file (fork/resume menyalin history).
- Cek 5.151 grup duplikat: 0 grup dengan usage berbeda (v2.1.3xx). ⚠️ Versi lama dilaporkan pernah beda → ambil **salinan terakhir** per `message.id`.
- **Kunci dedupe: `message.id`** (fallback `requestId`), global lintas file.

### Compaction ✅

`system/compact_boundary` → `compactMetadata: {trigger: "auto"|"manual", preTokens, postTokens, cumulativeDroppedTokens, durationMs}`. Bagus untuk metrik "berapa kali sesi kena auto-compact" dan "token terbuang".

### `system/turn_duration` ✅

`durationMs`, `messageCount` per turn → latensi per prompt.

## 3. File lain di `~/.claude` (struktur saja) ✅

| File | Isi (keys) | Guna |
|---|---|---|
| `~/.claude/history.jsonl` | `display, pastedContents, project, sessionId, timestamp` | Riwayat prompt lintas project (untuk fitur "cari prompt"); berisi teks prompt → sensitif |
| `~/.claude.json` → `projects[path]` | `lastCost, lastModelUsage, lastTotalInputTokens, lastTotalOutputTokens, lastTotalCache*Tokens, lastSessionId, lastDuration, lastLinesAdded/Removed` | Ringkasan sesi terakhir per project |
| `~/.claude.json` → `additionalModelCostsCache` | Tarif per model (USD/MTok): `inputTokens, outputTokens, promptCacheWriteTokens, promptCacheWrite1hTokens, promptCacheReadTokens, webSearchRequests`, plus `fast{}` & `longPrompt{abovePromptTokens,…}` | **Tabel harga siap pakai milik Claude Code** (cocok dengan halaman pricing) |
| `~/.claude/cache/model-catalog/*-cc.json` | `catalog.config.models[]` → `id, name, runtime.family, runtime.max_input_tokens, runtime.max_output_tokens, effort_levels`; `provider_alias_targets` (alias → model id per provider) | **Context window per model + resolusi alias** (`opus`→`claude-opus-5-5`) |
| `~/.claude/sessions/*.json` | `peerToken, pidDomain, procStart` | IPC, tidak relevan (jangan dibaca: token) |

> ⚠️ `additionalModelCostsCache` & `model-catalog` adalah cache internal, bisa berubah nama atau hilang. Pakai sebagai **sumber utama opsional** dengan fallback ke `pricing.json` milik app.

## 4. `cost-state`: biaya resmi versi Claude Code ✅/⚠️

```json
{"type":"cost-state","sessionId":"…","totalCostUSD":95.63,"totalAPIDuration":…,"totalToolDuration":…,
 "totalLinesAdded":1780,"totalLinesRemoved":158,"startTime":…,
 "modelUsage":{"claude-opus-4-6":{"inputTokens":…,"outputTokens":…,"thinkingTokens":…,
   "cacheReadInputTokens":…,"cacheCreationInputTokens":…,"cacheCreationEphemeral5mInputTokens":…,
   "cacheCreationEphemeral1hInputTokens":…,"webSearchRequests":0,"costUSD":95.63}},
 "hasUnknownModelCost":false}
```

- Kumulatif dan ditulis berulang. Ambil **entri terakhir per sesi**. ✅
- ⚠️ Belum dipastikan apakah sudah termasuk subagent, dan sejak versi berapa muncul. Ada di 174 entri dari 60 file (tidak di semua sesi).
- Pakai sebagai **pembanding** (rekonsiliasi) terhadap biaya hitungan kita, bukan sumber tunggal.

## 5. Hook payload: tidak ada token ✅

Docs hooks: input umum = `session_id, prompt_id, transcript_path, cwd, scratchpad_dir, permission_mode, effort.level, hook_event_name`, plus `agent_id`/`agent_type` di subagent. **Tidak ada field token/biaya di hook mana pun.** Model hanya ada di `SessionStart` (tidak selalu) dan `PreModelSwitch`/`PostModelSwitch` (`from_model`, `to_model`).
→ Hook cukup sebagai **trigger realtime** ("ada data baru di `transcript_path`, ingest sekarang"). Angka tetap dari JSONL.

**Status line** justru menerima data kaya (docs resmi) ✅: `cost.total_cost_usd`, `context_window.{total_input_tokens, context_window_size, used_percentage, remaining_percentage, current_usage}`, `rate_limits.five_hour/seven_day.{used_percentage, resets_at}` (Pro/Max/Ultra), `exceeds_200k_tokens`, `model`, `session_id`, `transcript_path`.
→ Opsi: app menyediakan perintah `statusline` yang **sekaligus** menampilkan bar dan mencatat snapshot `rate_limits` (data ini tidak ada di JSONL). Pendekatan ini sudah dipakai Claude-Code-Usage-Monitor v4.

⚠️ Alternatif: OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY`), dengan metrik token & cost resmi. Butuh collector, overkill untuk app lokal. Cukup dicatat.

## 6. Tool existing ✅ (gh API, 2026-11-27)

| Tool | ⭐ | Lisensi | Update terakhir | Fitur | Kekurangan / celah |
|---|---|---|---|---|---|
| [ccusage](https://github.com/ccusage/ccusage) | 19,6k | MIT | 2026-11-27 (aktif) | Laporan daily/weekly/monthly/session/5-jam block, per model, `--instances` per project, JSON, pricing override, statusline hook, 20+ CLI agent lain | CLI tabel, tanpa DB persisten (hilang setelah 30 hari), **tanpa atribusi per subagent/role**, tanpa drill-down prompt, tanpa dashboard web |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | 8,8k | MIT | 2026-07-05 | Monitor realtime TUI, prediksi limit, capture `rate_limits` via statusline, warehouse opsional > 30 hari, label provenance (official/estimate) | Python, fokus kuota/limit, tidak ada analitik agent/prompt |
| [claude-code-log](https://github.com/daaain/claude-code-log) | 1,3k | MIT | 2026-11-24 (aktif) | JSONL → HTML/MD, TUI, `serve` + full-text search, subagent sebagai cabang, token per pesan, timeline | Viewer transcript, bukan analitik biaya/agregasi |
| [sniffly](https://github.com/chiphuyen/sniffly) | 1,3k | MIT | 2025-08-08 (**stagnan** >1 thn) | Dashboard web (port 8081), pola pemakaian, analisis error, share | Tidak dirawat, format log sudah berubah banyak |

**Celah yang bisa diisi app kita:**
1. **Atribusi per role/agent** (manager vs reader vs writer) dan per model yang benar-benar melayani. Belum ada tool yang mengaitkan biaya dengan *role swarm* yang kita install. Ini pembeda utama, karena app kita sendiri yang mendefinisikan role-nya.
2. **Rekomendasi tier**: "role X pakai opus tapi 80% outputnya pendek → turunkan ke sonnet, hemat $Y". Datanya ada (usage + agentType + model).
3. **History persisten > 30 hari** di SQLite + drill-down sesi → prompt → subagent dalam satu UI lokal.
4. Single binary tanpa Python/Node runtime.

Jangan menduplikasi: laporan daily/monthly generik (ccusage sudah sangat matang). Cukup versi sederhana.

## 7. Harga model ✅ ([platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing), cocok dengan `additionalModelCostsCache` lokal)

USD per juta token (MTok):

| Model | Input | Cache write 5m | Cache write 1h | Cache read | Output |
|---|---|---|---|---|---|
| Fable 5.2 | 8 | 10 | 16 | 0,20 (0.025x) | 40 |
| Opus 5.5 | 4 | 5 | 8 | 0,20 (0.05x) | 20 |
| Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | 5 | 6,25 | 10 | 0,50 | 25 |
| Sonnet 5.5 | 2 | 2,50 | 4 | 0,10 (0.05x) | 10 |
| Sonnet 5 | 2 | 2,50 | 4 | 0,20 | 10 |
| Sonnet 4.6 / 4.5 | 3 | 3,75 | 6 | 0,30 | 15 |
| Haiku 5.5 (prompt ≤ 100k) | 0,10 | 0,125 | 0,20 | 0,01 | 0,50 |
| Haiku 5.5 (prompt > 100k) | 0,50 | 0,625 | 1 | 0,05 | 2,50 |
| Haiku 4.5 | 1 | 1,25 | 2 | 0,10 | 5 |

Modifier:
- **Long context**: model 4.6+ (kecuali Haiku 5.5) memakai harga standar hingga 1M token. **Haiku 5.5**: jika `input + cache_read + cache_write` per request > 100.000, seluruh request kena tarif tinggi.
- **Fast mode** (`usage.speed=="fast"`): Opus 5.5 $8/$40, Fable 5.2 $16/$80, Opus 5/4.8 $10/$50. Multiplier cache tetap berlaku di atasnya.
- **`inference_geo: "us"`**: 1.1x semua kategori (model 4.6+).
- **Web search**: $10 / 1.000 request (`server_tool_use.web_search_requests`). Web fetch gratis.
- Batch -50%: tidak relevan untuk Claude Code.
- Tokenizer 4.7+ ≈ +30% token untuk teks yang sama. Perlu diperhitungkan saat membandingkan biaya antar generasi model.

> **Wajib jadi config** (`~/.claude-manager/pricing.json`), bukan hardcode (Rule 15). Urutan resolusi: override user → `additionalModelCostsCache` lokal Claude Code → default bawaan binary. Simpan `pricing_version` di setiap baris biaya agar bisa dihitung ulang. Untuk user langganan Pro/Max, tampilkan sebagai "setara harga API".

Rumus per request:
```
p = tarif[model] (pilih tier longPrompt jika Haiku 5.5 & prompt>100k; tier fast jika speed=fast)
cost = (input*p.in + c5m*p.w5m + c1h*p.w1h + cache_read*p.read + output*p.out)/1e6
     + web_search*0.01
cost *= (inference_geo=="us" ? 1.1 : 1)
```
`thinking_tokens` sudah **termasuk** dalam `output_tokens` (jangan ditambah lagi). ⚠️ Konsisten dengan docs API; cek ulang saat implementasi.

## 8. Context window & "sisa context" ✅

- Window per model: `model-catalog` lokal → `runtime.max_input_tokens`. Semua model 5.x, serta Opus 4.6–4.8 dan Sonnet 4.6 = **1.000.000**. Haiku 4.5 = **200.000**. Fallback ke config.
- Rumus resmi (docs statusline): `used = input_tokens + cache_creation_input_tokens + cache_read_input_tokens` dari **pesan assistant terakhir di main chain** (`isSidechain=false`, bukan `<synthetic>`). Output tidak dihitung. `remaining = window - used`.
- Subagent punya context sendiri, jadi hitung per file `agent-*.jsonl` secara terpisah.
- Setelah `compact_boundary`, angka lama tidak berlaku. Pakai `compactMetadata.postTokens` sampai ada assistant berikutnya.
- ⚠️ Auto-compact terpicu **sebelum** window penuh. Dari sampel, `preTokens` ≈ 168k meskipun window 1M; kemungkinan sesi tersebut berjalan dengan window efektif 200k (alias tanpa `[1m]`) atau ambang auto-compact. Jadi "sisa context" sebaiknya ditampilkan relatif terhadap **window efektif**. Ambil dari `autoCompactWindowsCache` di `~/.claude.json` bila terisi; kalau tidak, dari konfigurasi.

---

## Implikasi desain

**Skema SQLite (minimal):**

```sql
files(path PK, size, mtime, offset, inode)              -- ingest incremental: baca dari offset saja
sessions(id PK, project_cwd, git_branch, title, first_ts, last_ts, version, cc_cost_usd)  -- cc_cost_usd dari cost-state terakhir
agents(id PK, session_id, agent_type, name, description, tool_use_id, spawn_depth, requested_model)
requests(message_id PK, request_id, session_id, agent_id NULL, ts, model, effort, speed, geo,
         input, cache_5m, cache_1h, cache_read, output, thinking, web_search,
         cost_usd, pricing_version, stop_reason, is_sidechain)
prompts(id PK /*promptId|uuid*/, session_id, ts, source, text NULL)   -- text NULL jika --no-prompt-text
tool_calls(tool_use_id PK, message_id, name, subagent_type NULL)
compactions(uuid PK, session_id, ts, trigger, pre_tokens, post_tokens)
```

- **Dedupe**: `requests.message_id` PRIMARY KEY + `INSERT … ON CONFLICT DO UPDATE` (salinan terakhir menang). Ini menyelesaikan duplikasi per content block dan duplikasi lintas file fork/resume.
- **Atribusi agent**: `requests.agent_id` dari field `agentId` entri di `subagents/agent-*.jsonl`. `agents.agent_type` dari `meta.json` (fallback: `tool_use.input.subagent_type` via `toolUseId`). Role swarm = `agent_type`. Main session = `agent_id NULL`, dan role-nya dari `--agent`/`attributionAgent` bila ada.
- **Project**: kelompokkan berdasarkan `cwd` (normalisasi ke git root bila perlu), bukan nama folder di `projects/`.
- **Biaya**: hitung saat ingest + simpan `pricing_version`. Sediakan `recompute` saat tabel harga berubah. Tampilkan selisih terhadap `cost-state` sebagai indikator akurasi.
- **Parser toleran**: whitelist `type` ∈ {user, assistant, system, cost-state, ai-title}. Hitung baris gagal parse untuk perintah `doctor`. Jangan pernah crash karena field baru.
- **Privasi**: teks prompt opsional (`--no-prompt-text`), DB `chmod 600`, jangan pernah membaca `sessions/*.key`.
