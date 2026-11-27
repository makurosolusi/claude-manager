import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { DayModelRow } from "../../server/dashboard.types.ts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart.tsx";
import { fmtModel, fmtUsd } from "@/lib/format.ts";
import { FAMILY_COLOR, modelFamily } from "@/lib/model.tier.ts";

/** Models drawn as their own series; the rest fold into "Other". */
export const CHART_TOP_MODELS = 4;
/** Name of the folded series. */
export const OTHER_LABEL = "Other";
const OTHER_COLOR = "var(--chart-5)";
const DAY_MS = 86_400_000;
const X_TICK_GAP_PX = 40;

/** A drawn series: safe data key ("s0", "s1", …; model ids may contain "[1m]"), model id (null = Other), fill. */
export interface Series { key: string; model: string | null; color: string }
/** One day bucket: `day` (YYYY-MM-DD, UTC) plus cost per series key. */
export type DayPoint = { day: string } & Record<string, number | string>;

/**
 * Pivots (day, model) rows into one point per UTC day from `startDay` to `endDay` (gaps filled with 0).
 * Top models by cost keep their family color; a second model of an already-used family takes the "other" color,
 * and anything left (or beyond CHART_TOP_MODELS) folds into "Other" so no two series share a color.
 */
export function pivotCostByDay(rows: DayModelRow[], startDay: string, endDay: string): { series: Series[]; points: DayPoint[] } {
  const byModel = new Map<string, number>();
  for (const r of rows) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.cost_usd);
  const used = new Set<string>();
  const series: Series[] = [];
  for (const [model] of [...byModel].sort((a, b) => b[1] - a[1])) {
    if (series.length === CHART_TOP_MODELS) break;
    const color = [FAMILY_COLOR[modelFamily(model)], FAMILY_COLOR.other].find((c) => !used.has(c));
    if (!color) continue;
    used.add(color);
    series.push({ key: `s${series.length}`, model, color });
  }
  const keyOf = new Map(series.map((s) => [s.model!, s.key]));
  const otherKey = `s${series.length}`;
  if (rows.some((r) => !keyOf.has(r.model))) series.push({ key: otherKey, model: null, color: OTHER_COLOR });

  const blank = () => Object.fromEntries(series.map((s) => [s.key, 0]));
  const points = new Map<string, DayPoint>();
  for (let t = Date.parse(startDay); t <= Date.parse(endDay); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    points.set(day, { day, ...blank() });
  }
  for (const r of rows) {
    const p: DayPoint = points.get(r.day) ?? { day: r.day, ...blank() };
    points.set(r.day, p);
    const k = keyOf.get(r.model) ?? otherKey;
    p[k] = (p[k] as number) + r.cost_usd;
  }
  return { series, points: [...points.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}

const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtDay = (day: string) => dayLabel.format(new Date(`${day}T00:00:00Z`));
const seriesLabel = (s: Series) => (s.model === null ? OTHER_LABEL : fmtModel(s.model));

/** Legend chips for the chart header: color dot + model name in text ink. */
export function CostLegend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: s.color }} />
          <span className="font-mono">{seriesLabel(s)}</span>
        </li>
      ))}
    </ul>
  );
}

type TipProps = { active?: boolean; label?: string | number; payload?: readonly { dataKey?: unknown; value?: unknown; color?: string }[] };

function DayTooltip({ active, label, payload, series }: TipProps & { series: Series[] }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => Number(p.value) > 0).reverse();
  const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div className="grid min-w-40 gap-1.5 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{fmtDay(String(label))}</div>
      {items.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: p.color }} />
          <span className="flex-1 font-mono text-muted-foreground">{seriesLabel(series.find((s) => s.key === p.dataKey)!)}</span>
          <span className="tabular-nums">{fmtUsd(Number(p.value))}</span>
        </div>
      ))}
      <div className="flex justify-between border-t pt-1.5 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{fmtUsd(total)}</span>
      </div>
    </div>
  );
}

/** Stacked daily cost bars, one series per top model; no animation. */
export function CostChart({ series, points }: { series: Series[]; points: DayPoint[] }) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: seriesLabel(s), color: s.color }])) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <BarChart data={points} margin={{ left: 0, right: 0, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={X_TICK_GAP_PX} tickFormatter={fmtDay} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtUsd(v)} />
        <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<DayTooltip series={series} />} isAnimationActive={false} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="cost" fill={s.color} stroke="var(--card)" strokeWidth={1} radius={i === series.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
