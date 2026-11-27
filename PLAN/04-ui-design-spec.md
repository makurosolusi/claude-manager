# 04 — UI Design Spec: Dashboard Polish (M5)

Status: draft untuk approval user · Branch: `feature/m5-ui-polish` · Pilot: Overview + Sessions + shared components.
Bukti "before": `/tmp/cm-ui-audit/before/` (1440 & 390, light + `dark-*`, `state-loading-*`). Data demo: `scripts/seed.demo.ts`.

Gaya: Vercel/Linear. Padat, monokrom, **satu accent** (biru). Kuning/merah hanya untuk peringatan (context, sync). Angka `tabular-nums`, id monospace. Dark default.
Tiga pertanyaan yang harus terjawab tanpa klik: (1) uang ke mana, (2) sesi mana aktif/hampir habis context, (3) split model per tier efisien atau tidak.

## 1. Audit ringkas

P0 = merusak jawaban/terlihat rusak · P1 = friksi jelas · P2 = polish.

| Halaman | Temuan | Prio |
|---|---|---|
| Global | Tema ikut OS → default render terang; tak ada dark default | P0 |
| Global | Range di `useState`, hilang saat reload/share; picker hilang di detail & Live (layout shift) | P1 |
| Global | Tak ada indikator sync; user tak tahu data segar atau macet | P1 |
| Global | "est." diulang di tiap sel cost; footer kontras rendah & melayang | P1 |
| Global | Hanya `chart-1/2`; chart-1 oranye (bukan accent) | P2 |
| Overview | KPI = Input/Output/Cache tokens; tak ada sessions, cache hit rate, delta vs periode lalu | P0 |
| Overview | Chart satu seri, tidak stacked per model; tick tanggal ISO panjang | P1 |
| Overview | Tak ada top projects/sessions & cost per tier; dua tabel 6 kolom angka tanpa hierarki | P0 |
| Overview (390) | KPI 2 kolom + kartu ke-5 yatim; range picker turun baris | P2 |
| Sessions | Judul kosong → UUID mentah; project hanya basename ("web" ambigu: acme/web vs side/web) | P0 |
| Sessions | 10 kolom (9 angka) setara bobotnya; tak ada model; Agents "0" | P1 |
| Sessions | Waktu absolut; tak bisa sort; filter hanya project path; baris tak terlihat bisa diklik | P1 |
| Sessions | Tabel dibungkus Card → padding ganda, tepi tabel tak sejajar header; baris tinggi | P1 |
| Sessions (390) | Tabel terpotong, hanya kolom Session terlihat, tanpa scroll | P1 |
| States | Loading = spinner teks di halaman kosong; error/empty hanya teks, tanpa aksi retry | P2 |
| Session detail | Tanggal "Active" patah di tengah kata (`break-all`) | P1 |
| Live | Bar menampilkan context *left* (8% left = sliver merah kecil) → terbalik dari "used" | P0 |
| Live | Grid 3 kolom banyak ruang kosong; waktu absolut | P2 |
| Roles | role×model campur; "main" bukan preset; tak ada pengelompokan tier | P1 |

## 2. Design tokens (`src/web/index.css`)

Nama shadcn dipertahankan (komponen `ui/*` sudah memakainya); nilai diganti + token baru. `:root` = **dark**; light lewat `:root[data-theme="light"]`. Toggle tema di header (localStorage key `cm-theme`); tanpa pilihan → dark. `@custom-variant dark` diganti ke `(&:where(:root:not([data-theme=light]) *))`.

| Token | Dark (default) | Light | Pakai untuk |
|---|---|---|---|
| `--background` | `oklch(0.145 0 0)` | `oklch(0.99 0 0)` | kanvas |
| `--card` | `oklch(0.175 0 0)` | `oklch(1 0 0)` | surface panel |
| `--surface-hover` (baru) | `oklch(0.21 0 0)` | `oklch(0.965 0 0)` | hover baris, nav aktif |
| `--border` | `oklch(1 0 0 / 9%)` | `oklch(0 0 0 / 9%)` | garis 1px |
| `--input` | `oklch(1 0 0 / 14%)` | `oklch(0 0 0 / 14%)` | border kontrol |
| `--foreground` | `oklch(0.97 0 0)` | `oklch(0.17 0 0)` | teks utama |
| `--muted-foreground` | `oklch(0.72 0 0)` | `oklch(0.45 0 0)` | label, header kolom |
| `--fg-subtle` (baru) | `oklch(0.62 0 0)` | `oklch(0.52 0 0)` | project dim, short id, footer |
| `--muted`, `--accent`, `--secondary` | `oklch(0.21 0 0)` | `oklch(0.965 0 0)` | latar netral (bukan brand) |
| `--primary` | `oklch(0.97 0 0)` | `oklch(0.17 0 0)` | tombol aktif (putih/hitam) |
| `--brand` (baru) | `oklch(0.70 0.15 245)` | `oklch(0.53 0.19 255)` | satu-satunya accent: link fokus, ring, chart-1 |
| `--ring` | `var(--brand)` | `var(--brand)` | focus ring 2px |
| `--ok` (baru) | `oklch(0.76 0.15 155)` | `oklch(0.52 0.14 155)` | context < 70% |
| `--warn` (baru) | `oklch(0.82 0.16 85)` | `oklch(0.55 0.13 70)` | context ≥ 70%, sync stalled |
| `--destructive` | `oklch(0.70 0.19 25)` | `oklch(0.55 0.21 27)` | context ≥ 90%, error |
| `--chart-1` | `var(--brand)` | `var(--brand)` | opus |
| `--chart-2` | `oklch(0.80 0.10 200)` | `oklch(0.66 0.11 205)` | sonnet |
| `--chart-3` | `oklch(0.62 0 0)` | `oklch(0.60 0 0)` | haiku |
| `--chart-4` | `oklch(0.45 0 0)` | `oklch(0.78 0 0)` | model lain |
| `--chart-5` | `oklch(0.32 0 0)` | `oklch(0.88 0 0)` | bucket "Other" |

Daftarkan `--color-brand/ok/warn/fg-subtle/surface-hover/chart-3..5` di `@theme inline`.

**Kontras (WCAG AA, wajib dicek dengan kalkulator saat implementasi):** teks ≥ 4.5:1 (`foreground`, `muted-foreground`, `fg-subtle` vs `background` dan `card`, kedua tema); UI non-teks (border kontrol, bar, dot) ≥ 3:1; `warn` sebagai teks di light harus ≥ 4.5:1, kalau gagal gelapkan L. Warna tak pernah jadi satu-satunya sinyal: ContextBar juga menulis persen, SyncIndicator juga menulis teks.

**Radius:** `--radius: 0.5rem` → panel 8px, kontrol 6px, badge/dot-chip 4px.
**Spacing:** skala Tailwind 4px; hanya `1 2 3 4 6 8 12`. Gap antar section 24px (`gap-6`), dalam panel 12–16px.
**Tipografi:** sans `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` (lokal, tanpa webfont/network); mono `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace`.

| Peran | Ukuran / berat | Catatan |
|---|---|---|
| Page title | 20px / 600, tracking -0.01em | `h1` |
| Section title | 13px / 500, `muted-foreground` | judul panel, tanpa CardTitle besar |
| Body / sel tabel | 13px / 400 | `tabular-nums` di semua angka |
| Header kolom | 12px / 500, `muted-foreground` | tanpa uppercase |
| Caption, footer, dim | 12px / 400 | `fg-subtle` |
| KPI value | 28px / 600, `tabular-nums`, tracking -0.02em | |
| Id, model, path | mono 12px | |

## 3. Layout shell (`app.tsx`)

```
┌ sticky h-12, border-b, bg-background/80 backdrop-blur ───────────────────────────────────────┐
│ ▪ claude-manager   Overview  Projects  Sessions  Roles  Live     ● Synced 3s ago  [24h|7d|30d|90d|All]  ◐ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
  <main> max-w-[1280px] mx-auto px-6 (px-4 < sm) py-6, flex-col gap-6
  ── footer border-t py-4 text-xs fg-subtle ─────────────────────────────────────────────────────
  Costs are estimates at public API list prices, not your bill.          Local only · 127.0.0.1
```

- Header, main, footer berbagi **satu** container (`max-w-[1280px] px-6`) → tepi kiri/kanan sejajar persis.
- Logo: kotak 10px `bg-brand` rounded-[2px] + teks `claude-manager` mono 13px/600.
- Nav: 13px, aktif = `text-foreground bg-surface-hover`, lain `muted-foreground hover:text-foreground`. Link nav mempertahankan `range` (pakai `hashHref`).
- **Range di URL:** param hash `range` (`#/sessions?range=7d&q=api`). Nilai tak valid/absen → `30d`, default tidak ditulis ke URL. `lib/range.ts` tambah `parseRange(v: string | null): Range`. Picker **selalu dirender**; di Session detail & Live → `disabled` + `title="Not filtered by time range"` (tak ada layout shift).
- Mobile (<640): header 2 baris (logo+sync+tema / nav scroll-x + picker), tanpa overflow horizontal halaman.
- Footer menempel bawah lewat `min-h-dvh flex-col` + `mt-auto`; teks `fg-subtle` (≥ 4.5:1).
- Refresh data: `useSyncMeta()` poll `/api/meta` tiap `interval_ms`; saat `changed_at` berubah, `dataVersion` naik dan dipakai sebagai `tick` di `useApi` semua halaman (Live ikut mekanisme ini, `LIVE_REFRESH_MS` dihapus di wave 3).

## 4. Shared components (props API)

Semua file baru di `src/web/components/`, ≤ 150 baris, satu komponen utama per file, docstring 1 baris per export.

```ts
// data.table.tsx — pengganti DataTable di usage.table.tsx (yang lama tetap hidup sampai wave 3)
export type SortDir = "asc" | "desc";
export interface Sort { key: string; dir: SortDir }
export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";        // angka WAJIB "right"
  sortKey?: string;                 // ada = header jadi tombol sort
  width?: string;                   // mis. "w-24"; kolom pertama fleksibel
  hideBelow?: "sm" | "md" | "lg";   // responsif
}
export interface DataTableProps<T> {
  rows: T[] | undefined;            // undefined + loading = skeleton
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;     // baris klik + Enter; sel pertama juga <a href> (middle-click jalan)
  sort?: Sort;
  onSort?: (s: Sort) => void;       // klik: kolom baru → desc; kolom sama → toggle
  density?: "compact" | "comfortable"; // 36px / 44px, default compact
  loading?: boolean;
  error?: Error;
  onRetry?: () => void;
  empty?: ReactNode;                // default "Nothing here for this range."
  skeletonRows?: number;            // default 8
  label: string;                    // aria-label tabel
}
```
- Header `sticky top-12` (di bawah header app), `bg-background`, border-b. Header sort: `aria-sort`, ikon `ArrowUp/ArrowDown` 12px hanya di kolom aktif, `ChevronsUpDown` redup saat hover.
- Baris: border-b `border`, hover `bg-surface-hover`, `cursor-pointer` bila `rowHref`, focus-visible ring `brand`. Tanpa Card pembungkus; tabel full-width container.
- States di dalam tabel (header tetap tampil): loading = baris skeleton `bg-muted animate-pulse` tinggi sama; error = satu baris `role="alert"` ikon `TriangleAlert` warna destructive + pesan + tombol "Retry"; empty = satu baris tinggi 120px, teks tengah `muted-foreground`. Reload dengan data lama → data lama tetap, opacity 60%.
- Wrapper `overflow-x-auto` agar <390 tidak memotong.

```ts
// kpi.card.tsx
export interface KpiCardProps {
  label: string;                    // "Est. cost"
  value: ReactNode;
  delta?: { value: number | null; unit: "pct" | "pt"; periodLabel: string }; // null = "No prior data"
  hint?: ReactNode;                 // baris kecil di bawah, opsional
}
```
Delta netral (monokrom): `↑ 12.4%` / `↓ 3.1 pt` 12px `muted-foreground` + ` vs prev 30d` `fg-subtle`. Tanpa hijau/merah (warna hanya untuk peringatan).

```ts
// token.cell.tsx — total = input + output + cache_read + cache_write
export function TokenCell(props: { usage: Pick<Usage, "input" | "output" | "cache_read" | "cache_write"> }): JSX.Element;
// cost.cell.tsx — angka saja; "est." hanya di header kolom / label KPI
export function CostCell(props: { usd: number; unpriced?: number }): JSX.Element; // unpriced>0 → "$1.20*" + tooltip "N requests with unknown pricing excluded"
// relative.time.tsx — <time dateTime={iso} title={absolute}>
export function RelativeTime(props: { iso: string | null }): JSX.Element; // null → "—"
// session.cell.tsx — satu baris: judul truncate + project dim
export function SessionCell(props: { id: string; title: string | null; projectCwd: string | null; href: string }): JSX.Element;
// context.bar.tsx — persen TERPAKAI
export function ContextBar(props: { used: number; window: number; size?: "sm" | "md" }): JSX.Element;
// sync.indicator.tsx
export function SyncIndicator(props: { meta: SyncMeta | undefined; now: number }): JSX.Element;
// page.header.tsx
export function PageHeader(props: { title: string; description?: ReactNode; actions?: ReactNode }): JSX.Element;
// range.picker.tsx
export function RangePicker(props: { value: Range; onChange: (r: Range) => void; disabled?: boolean }): JSX.Element;
// ui/tooltip.tsx — CSS-only (group-hover + group-focus-within), tanpa Radix
export function Tooltip(props: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }): JSX.Element;
```
Detail perilaku:
- **TokenCell:** `1.2M`; trigger fokusable (`tabIndex=0`); tooltip grid 2 kolom: Input / Output / Cache read / Cache write (`fmtInt`) + garis + `Cache hit 91%`.
- **RelativeTime:** `fmtRelative(iso, now)`: <45s `just now`, <60m `12m ago`, <24h `5h ago`, <7d `3d ago`, tahun sama `Nov 3`, lainnya `Nov 3, 2025`. `now` dari `useNow(30_000)` (`lib/now.ts`, satu interval bersama).
- **SessionCell:** judul ada → judul (13px fg). Kosong → `Untitled session` (`muted-foreground`, italic) + ` 5decb594` mono `fg-subtle`. Lalu project `acme/web` (mono 12px `fg-subtle`, `max-w-[18ch] truncate`, `title` = path penuh). Judul `<a href>` = target klik baris.
- **ContextBar:** `pct = round(used/window*100)`; `< 70` `ok`, `≥ 70` `warn`, `≥ 90` `destructive` (konstanta `CONTEXT_WARN_PCT = 70`, `CONTEXT_DANGER_PCT = 90` di `lib/context.level.ts`). Track `bg-muted` h-1.5 (sm) / h-2 (md). Label kanan: `142k / 200k · 71%`. `role="meter"`, `aria-valuenow/min/max`, `aria-label="Context used"`.
- **SyncIndicator:** dot 6px + teks 12px `muted-foreground`. Normal: dot `ok`, `Synced 3s ago`. `now - synced_at > 3 × interval_ms` → dot `warn`, `Sync stalled · 2m`. `error` → dot `destructive`, `Sync failed`, tooltip = pesan error. `meta` undefined → dot `muted`, `Connecting…`. `aria-live="polite"` hanya untuk perubahan status, bukan tiap detik.
- **Format (`lib/format.ts`):** tambah `fmtRelative`, `fmtProject(cwd)` (2 segmen terakhir, `—` bila null), `fmtModel(id)` (`claude-opus-4-7` → `opus-4-7`), `fmtPct(n)` (`91.2%`), `fmtDelta(cur, prev)` → `number | null`. Hapus `shortPath` di wave 3 setelah tak terpakai.
- **`lib/model.family.ts`:** `modelFamily(id): "opus" | "sonnet" | "haiku" | "other"` (substring), `FAMILY_TIER = { opus: "think", sonnet: "work", haiku: "basic" }`, `FAMILY_COLOR` → `var(--chart-1..4)`. Dot model 8px pakai warna ini di tabel, chart, legend (konsisten lintas halaman).

## 5. Pilot: Overview (`#/`)

```
Overview                                                         (PageHeader)
Last 30 days · all projects
┌ Est. cost ─────┐┌ Requests ──────┐┌ Sessions ──────┐┌ Cache hit rate ┐   4 kolom ≥lg, 2 kolom <lg
│ $52.16         ││ 886            ││ 42             ││ 91.2%          │
│ ↑ 12.4% vs prev 30d             ...                 │ ↑ 1.3 pt ...   │
└────────────────┘└────────────────┘└────────────────┘└────────────────┘
┌ Cost per day (est.) ──────────────────────────── ● opus-4-7 ● sonnet-4-5 ● haiku-4-5 ┐
│ stacked bars h-56, y $ kecil, x "Nov 3" tiap ~7 hari, tooltip: hari + per model + total  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
┌ Top projects ──────────── View all → ┐┌ Top sessions ─────────────── View all → ┐   2 kolom ≥lg
│ acme/api            $18.20  ▇▇▇▇▇▇  ││ Debug CORS preflight… infra-…  $2.55 2d ago │
│ … 5 baris                            ││ … 5 baris                                   │
└──────────────────────────────────────┘└─────────────────────────────────────────────┘
┌ Cost by tier ─────────────────────────────────────────────────────────────────────────────┐
│ Tier            Share            Cost (est.)   Requests   Cache hit   Cost / request       │
│ think · opus    ▇▇▇▇▇▇▇▇ 58%     $30.10        210        93%         $0.143               │
│   opus-4-7                       $30.10        210        93%         $0.143   (sub-baris) │
│ work · sonnet   ▇▇▇▇ 31%         …                                                         │
│ basic · haiku   ▇ 11%            …                                                         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
- KPI (urutan tetap): `Est. cost` (`unpriced>0` → hint `N requests unpriced`), `Requests`, `Sessions`, `Cache hit rate` = `cache_read / (input + cache_read + cache_write)`. Delta: cost/requests/sessions dalam `%`, cache hit dalam `pt`. Range `All` → tanpa delta (`prev = null`), teks `All time`.
- Chart: `byDayModel` di-pivot client; 4 model teratas by cost dapat warna family, sisanya digabung `Other` (`chart-5`). Hari tanpa data tetap muncul (isi 0) agar sumbu x rata. Tanpa animasi (`isAnimationActive={false}`).
- Top projects: `GET /api/projects?pageSize=5&since&` (sudah urut cost desc); kolom: project (`fmtProject`, title path penuh), cost, bar share 64px (`bg-brand/70`). Klik → `#/sessions?project=<cwd>`.
- Top sessions: `GET /api/sessions?sort=cost&dir=desc&pageSize=5`; kolom: SessionCell, cost, RelativeTime. Klik → detail.
- Cost by tier: diturunkan client dari `byModel` via `modelFamily` (tanpa API baru). Urut think→work→basic→other; sub-baris per model (`fmtModel`, 12px `fg-subtle`). Tabel `By model` & `By role` lama **dihapus** dari Overview (role ada di halaman Roles).
- Copy: description `Last 30 days · all projects` / `Last 24 hours` / `All time`; empty `No usage in this range. Try a wider range.`; error `Couldn't load overview.` + pesan server.

## 6. Pilot: Sessions (`#/sessions`)

```
Sessions                                                [ Search title, id or project…  ⌘K ]
42 sessions · Last 30 days        project: acme/web ×   (chip hanya bila ?project=)
Session                                  Model          Agents  Requests   Tokens   Cost (est.)   Last active ↓
Add Stripe webhook retry…  acme/api      ● opus-4-7          —         4     571k        $0.63         2m ago
Untitled session 1399a9bf  acme/web      ● sonnet-4-5 +1     3        25     868k        $1.39         6d ago
…                                                                   Showing 1–50 of 42   ‹ Prev  Next ›
```
| # | Kolom | Isi | Align | Sort key | Sembunyi < |
|---|---|---|---|---|---|
| 1 | Session | `SessionCell` | left, flex | — | — |
| 2 | Model | dot + `fmtModel(model)` + ` +N` bila `models>1` (title = daftar) | left, w-36 | — | md |
| 3 | Agents | `—` bila 0 | right, w-16 | `agents` | md |
| 4 | Requests | `fmtInt` | right, w-20 | `requests` | sm |
| 5 | Tokens | `TokenCell` | right, w-20 | `tokens` | sm |
| 6 | Cost (est.) | `CostCell` | right, w-24 | `cost` | — |
| 7 | Last active | `RelativeTime(last_ts)` | right, w-24 | `last` | — |

- Default sort `last desc`. State `q`, `sort`, `dir`, `page`, `project`, `range` di hash (`hashHref`), sehingga back/share jalan. Ganti q/sort/range → page 1.
- Search: satu input 280px, debounce 250 ms, `type="search"`, `aria-label="Search sessions"`; `/` fokus ke input (`⌘K` opsional, P2). Placeholder `Search title, id or project…`. Param `project` dari Projects page tampil sebagai chip yang bisa dihapus.
- Hitungan: `{total} sessions` + label range. Pager: `Showing 1–50 of 42` + tombol `Previous`/`Next` (ghost, disabled di ujung).
- Copy: empty tanpa q `No sessions in this range.`; empty dengan q `No sessions match "{q}".` + tombol `Clear search`; error `Couldn't load sessions.` + `Retry`.

## 7. Kebutuhan API (opsi paling minimal)

| Kebutuhan | Keputusan |
|---|---|
| Delta vs periode lalu | `Overview.prev` (server; window sama panjang tepat sebelum `since`; `null` untuk All) |
| Sessions count | `sessions` di totals (`COUNT(DISTINCT r.session_id)`) |
| Cache hit rate | client dari totals, **tanpa API** |
| Cost per tier | client dari `byModel` + `modelFamily`, **tanpa API** |
| Stacked chart | `Overview.byDayModel` baru |
| Top projects / sessions | endpoint lama + `pageSize=5` (+ `sort=cost`), **tanpa endpoint baru** |
| Model utama sesi | `SessionRow.model`, `SessionRow.models` |
| Sort, search | `/api/sessions?sort&dir&q` |
| Last sync | `GET /api/meta` |

```ts
// src/db/stats.repository.ts
export interface StatsFilter { since: string; until?: string; project?: string } // until eksklusif
export const WHERE = "r.ts >= $since AND ($until IS NULL OR r.ts < $until) AND ($project IS NULL OR instr(s.project_cwd, $project) > 0)";
export type Totals = Omit<UsageRow, "key"> & { sessions: number };
export function usageTotal(db: Database, f: StatsFilter): Totals;              // + COUNT(DISTINCT r.session_id)
export interface DayModelRow { day: string; model: string; cost_usd: number; requests: number }
export function costByDayModel(db: Database, f: StatsFilter, limitDays: number): DayModelRow[]; // GROUP BY day, model

// src/server/dashboard.types.ts
export interface Overview { since: string; total: Totals; prev: Totals | null; byDay: UsageRow[]; byDayModel: DayModelRow[]; byModel: UsageRow[]; byRole: UsageRow[] }
export interface SessionRow extends Usage { /* field lama */ model: string | null; models: number }
export const SESSION_SORTS = ["last", "cost", "requests", "tokens", "agents"] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];
export interface SessionQuery { sort: SessionSort; dir: "asc" | "desc"; q?: string }
export interface SyncMeta { synced_at: string | null; changed_at: string | null; error: string | null; interval_ms: number }
```
- `prev`: `prevSince = since − (now − since)`, `until = since`; `since` = epoch 0 → `null`. `overview(db, f, now = Date.now())` agar bisa dites.
- `model` = model dengan request terbanyak di main agent (`agent_id IS NULL`), fallback model terbanyak keseluruhan; `models` = `COUNT(DISTINCT r.model)`. Subquery terkorelasi dibatasi page (≤200 baris), pakai index `requests_session`.
- Sort → map whitelist ke SQL (`last`→`s.last_ts`, `cost`→`cost_usd`, `tokens`→`input+output+cache_read+cache_write`, …), selalu tambah `, s.id` sebagai tiebreak. Nilai di luar whitelist / `dir` lain → **400** `invalid sort "x": use one of last, cost, …`.
- `q` (maks 200 char, trim): `instr(lower(coalesce(s.title,'') || ' ' || s.id || ' ' || coalesce(s.project_cwd,'')), lower($q)) > 0`; digabung AND dengan `project`. `ponytail:` full scan tabel sessions; FTS bila > ~100k sesi.
- `/api/meta`: `handleApi(req, db, port, meta?: () => SyncMeta)`; tanpa `meta` → `{ synced_at: null, changed_at: null, error: null, interval_ms }`. `dashboard.command.ts` menyimpan state: `synced_at` tiap sync sukses, `changed_at` bila `newRequests > 0 || changed > 0`, `error` = pesan sync terakhir yang gagal (reset saat sukses).
- File berubah: `src/db/stats.repository.ts`, `src/db/dashboard.repository.ts`, `src/server/dashboard.types.ts`, `src/server/dashboard.api.ts`, **baru** `src/server/dashboard.params.ts` (pindahan `intParam/pageQuery/filter` + `sessionQuery`, menjaga `dashboard.api.ts` < 150 baris), `src/commands/dashboard.command.ts`, `test/dashboard.test.ts`. Tanpa perubahan schema/migration.
- Test wajib (bun test, fixture sintetis yang ada): prev `null` untuk `since=1970-…`, prev berisi untuk window yang punya data sebelumnya; `total.sessions`; Σ`byDayModel.cost_usd` = Σ`byDay.cost_usd`; `sort=cost&dir=desc` urut benar; `sort=x` → 400; `q` cocok judul, id prefix, path; `model`/`models` untuk sesi OLD; `/api/meta` dengan & tanpa provider.

## 8. Pembagian kerja (worker, kepemilikan file eksklusif)

**Wave 1 (paralel)**

| Worker | File (eksklusif) | Output |
|---|---|---|
| `wkr-api-01` | `src/db/stats.repository.ts`, `src/db/dashboard.repository.ts`, `src/server/dashboard.types.ts`, `src/server/dashboard.api.ts`, `src/server/dashboard.params.ts` (baru), `src/commands/dashboard.command.ts`, `test/dashboard.test.ts` | Kontrak §7 + test |
| `wkr-ui-kit-01` | `src/web/index.css`, `src/web/lib/{format,range,now,model.family,context.level}.ts`, `src/web/components/ui/tooltip.tsx`, `src/web/components/{data.table,kpi.card,token.cell,cost.cell,relative.time,session.cell,context.bar,sync.indicator,page.header,range.picker}.tsx`, `test/web.format.test.ts` (baru) | Tokens §2 + komponen §4 + test `fmtRelative/fmtProject/fmtModel/fmtDelta/modelFamily/parseRange` |

`wkr-ui-kit-01` mengimpor tipe dari `dashboard.types.ts` sesuai §7 (boleh sementara lokal `type SyncMeta` bila wave 1 belum merge; dihapus di wave 2). Jangan sentuh `usage.table.tsx`, `cost.label.tsx`, `status.view.tsx` (masih dipakai halaman non-pilot).

**Wave 2 (paralel, setelah wave 1 di-review)**

| Worker | File |
|---|---|
| `wkr-shell-01` | `src/web/app.tsx`, `src/web/lib/hash.route.ts`, `src/web/lib/api.client.ts` (retry + `dataVersion`), `src/web/lib/sync.meta.ts` (baru, `useSyncMeta`) |
| `wkr-overview-01` | `src/web/pages/overview.page.tsx` (+ `src/web/components/tier.table.tsx`, `src/web/components/cost.chart.tsx` baru bila > 150 baris) |
| `wkr-sessions-01` | `src/web/pages/sessions.page.tsx` |

Halaman menerima `{ since, range, dataVersion }` sebagai props; kontrak prop ini ditetapkan di sini agar shell & halaman paralel.

**Wave 3 (hanya setelah user approve pilot):** Projects, Roles (kelompok per tier), Live (`ContextBar` terpakai + RelativeTime, grid auto-fill min 320px), Session detail (perbaikan `break-all`, agent tree + cost), lalu hapus `usage.table.tsx`, `cost.label.tsx`, `status.view.tsx`, `shortPath` bila sudah tanpa pemakai. README/CHANGELOG sekali di akhir oleh satu worker.

Verifikasi tiap wave: `bun test`, `bun run typecheck`, `bun run build`, lalu screenshot ulang dengan data demo:
`bun scripts/seed.demo.ts $T/.claude && HOME=$T CLAUDE_CONFIG_DIR=$T/.claude CLAUDE_MANAGER_HOME=$T/.cm bun src/cli.ts dashboard --port 5791` (`$T` = dir temp; **jangan** pakai `~/.claude` asli). Simpan ke `/tmp/cm-ui-audit/after/` dengan nama file sama seperti `before/`.

## 9. Acceptance criteria

Screenshot (1440 & 390, dark default + light via toggle):
- [ ] Load pertama tanpa setting → dark. Toggle → light; reload mempertahankan pilihan.
- [ ] Tepi kiri/kanan logo, konten, tabel, footer sejajar dalam satu garis vertikal di 1440.
- [ ] Header menampilkan `Synced Ns ago` yang bertambah; range picker tampil di semua halaman (disabled di Live/detail), tanpa layout shift saat pindah halaman.
- [ ] Overview: tepat 4 KPI (Est. cost, Requests, Sessions, Cache hit rate) dengan delta; di `All` delta tidak tampil.
- [ ] Chart stacked per model dengan legend; warna opus = accent biru, sama dengan dot model di Sessions.
- [ ] Top projects & Top sessions masing-masing 5 baris; Cost by tier 3 baris tier + sub-baris model.
- [ ] Sessions: 7 kolom; tak ada UUID mentah sebagai judul (`Untitled session` + 8 char id); dua project "web" terbaca `acme/web` vs `side/web`; Agents 0 = `—`; waktu relatif; "est." hanya di header `Cost (est.)`.
- [ ] Sessions 1440: ≥ 18 baris terlihat di atas fold 900px (tinggi baris 36px).
- [ ] Sessions 390: Session, Cost, Last active terlihat; tanpa scroll horizontal halaman.
- [ ] Klik header Cost → urut turun, klik lagi → naik, panah tampil; URL hash berubah; reload mempertahankan urutan & search.
- [ ] Ketik `cors` → baris "Debug CORS preflight on staging" muncul, hitungan berubah; empty search menampilkan `Clear search`.
- [ ] Loading = skeleton dengan header tabel; error (stub 500) = baris alert + `Retry`.
- [ ] Footer kontras ≥ 4.5:1 (cek devtools), menempel bawah.

Kode:
- [ ] Tidak ada warna literal di komponen (`#…`, `oklch(` di luar `index.css`); semua lewat token.
- [ ] Semua sel angka `text-right tabular-nums`; id/model/path `font-mono`.
- [ ] Ambang 70/90, debounce, interval → konstanta bernama (Rule 15), bukan literal di JSX.
- [ ] Setiap file baru ≤ 150 baris (komponen) / ≤ 300 (service), docstring 1 baris per export.
- [ ] Tak ada dependency baru; tak ada Radix; tak ada animasi chart.
- [ ] `bun test`, `bun run typecheck`, `bun run build` hijau; test baru di §7 dan `test/web.format.test.ts` ada dan berisi assertion nyata.
- [ ] Tak ada empty catch; error API menyebut endpoint + status (pola `getJson` lama dipertahankan).

## 10. Keputusan yang perlu user

1. **Tema:** dark selalu default + toggle (spec ini), atau ikuti OS dengan dark sebagai fallback?
2. **Tier = family model** (opus→think, dst.). Bila user override tier→model di config (mis. think=sonnet), label tier bisa menyesatkan. Alternatif: tampilkan per family saja tanpa nama tier.
3. Tabel `By model` / `By role` dihapus dari Overview (pindah ke Cost by tier + halaman Roles). Setuju?
4. Delta warna netral (tanpa hijau/merah). Setuju, atau cost naik = kuning?
