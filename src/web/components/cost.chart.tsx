import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { FAMILIES, type DayModelRow } from "../../server/dashboard.types.ts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart.tsx";
import { fmtModel, fmtUsd, fmtUsdAxis } from "@/lib/format.ts";
import { FAMILY_ICON } from "@/lib/icon.map.ts";
import { FAMILY_COLOR, FAMILY_LABEL, modelFamily, type ModelFamily } from "@/lib/model.tier.ts";

const DAY_MS = 86_400_000;
const X_TICK_GAP_PX = 40;
/** Series follow FAMILIES order, bottom to top; a family only becomes a series when it has cost in range. */
/** A drawn series: one model family (key = family), its fill colour. */
export interface Series { key: ModelFamily; color: string }
/** One day bucket: `day` (YYYY-MM-DD, UTC) plus cost per family key. */
export type DayPoint = { day: string } & Record<string, number | string>;
/** Cost per model id inside each family, per day: feeds the tooltip. */
export type DayModels = Record<string, Partial<Record<ModelFamily, Record<string, number>>>>;

/**
 * Pivots (day, model) rows into one point per UTC day from `startDay` to `endDay` (gaps filled with 0), stacked by family.
 * Unknown models fall into "other", so the family values always sum to the day's total.
 */
export function pivotCostByDay(rows: DayModelRow[], startDay: string, endDay: string): { series: Series[]; points: DayPoint[]; models: DayModels } {
  const present = new Set(rows.map((r) => modelFamily(r.model)));
  const series = FAMILIES.filter((f) => present.has(f)).map((f): Series => ({ key: f, color: FAMILY_COLOR[f] }));
  const blank = () => Object.fromEntries(series.map((s) => [s.key, 0]));
  const points = new Map<string, DayPoint>();
  for (let t = Date.parse(startDay); t <= Date.parse(endDay); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    points.set(day, { day, ...blank() });
  }
  const models: DayModels = {};
  for (const r of rows) {
    const p: DayPoint = points.get(r.day) ?? { day: r.day, ...blank() };
    points.set(r.day, p);
    const f = modelFamily(r.model);
    p[f] = (p[f] as number) + r.cost_usd;
    const byFamily = (models[r.day] ??= {});
    const byModel = (byFamily[f] ??= {});
    byModel[r.model] = (byModel[r.model] ?? 0) + r.cost_usd;
  }
  return { series, points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)), models };
}

const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (day: string) => dayLabel.format(new Date(`${day}T00:00:00Z`));

/** Legend for the chart header: family icon + name in text ink, colour as a secondary mark. */
export function CostLegend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => {
        const Icon = FAMILY_ICON[s.key];
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
            <Icon aria-hidden className="size-3.5" />
            <span>{FAMILY_LABEL[s.key]}</span>
          </li>
        );
      })}
    </ul>
  );
}

type TipProps = { active?: boolean; label?: string | number; payload?: readonly { dataKey?: unknown; value?: unknown; color?: string }[] };

function DayTooltip({ active, label, payload, models }: TipProps & { models: DayModels }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => Number(p.value) > 0).reverse();
  const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div className="grid min-w-44 gap-1.5 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{fmtDay(String(label))}</div>
      {items.map((p) => {
        const f = p.dataKey as ModelFamily;
        const detail = Object.entries(models[String(label)]?.[f] ?? {}).sort((a, b) => b[1] - a[1]);
        return (
          <div key={f} className="grid gap-0.5">
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-[2px]" style={{ background: p.color }} />
              <span className="flex-1">{FAMILY_LABEL[f]}</span>
              <span className="tabular-nums">{fmtUsd(Number(p.value))}</span>
            </div>
            {detail.map(([m, usd]) => (
              <div key={m} className="flex gap-2 pl-4 text-fg-subtle">
                <span className="flex-1 truncate font-mono">{fmtModel(m)}</span>
                <span className="tabular-nums">{fmtUsd(usd)}</span>
              </div>
            ))}
          </div>
        );
      })}
      <div className="flex justify-between border-t pt-1.5 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{fmtUsd(total)}</span>
      </div>
    </div>
  );
}

/** 2px surface gap between stacked segments. */
const BAR_GAP_PX = 2;
const BAR_TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** Stacked daily cost bars, one series per model family; no animation. */
export function CostChart({ series, points, models }: { series: Series[]; points: DayPoint[]; models: DayModels }) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: FAMILY_LABEL[s.key], color: s.color }])) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <BarChart data={points} margin={{ left: 0, right: 0, top: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={X_TICK_GAP_PX} tickFormatter={fmtDay} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={fmtUsdAxis} />
        <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<DayTooltip models={models} />} isAnimationActive={false} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="cost" fill={s.color} stroke="var(--card)" strokeWidth={BAR_GAP_PX} radius={i === series.length - 1 ? BAR_TOP_RADIUS : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
