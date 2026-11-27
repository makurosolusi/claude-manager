import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Overview, UsageRow } from "../../server/dashboard.types.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart.tsx";
import { StatusView } from "@/components/status.view.tsx";
import { Cost, COST_NOTE } from "@/components/cost.label.tsx";
import { DataTable, usageColumns, type Column } from "@/components/usage.table.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtTokens, fmtUsd } from "@/lib/format.ts";

const chartConfig = { cost_usd: { label: "Est. cost", color: "var(--chart-1)" } } satisfies ChartConfig;

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

function UsageCard({ title, keyHead, rows }: { title: string; keyHead: string; rows: UsageRow[] }) {
  const columns: Column<UsageRow>[] = [{ head: keyHead, cell: (r) => r.key }, ...usageColumns<UsageRow>()];
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? <DataTable rows={rows} columns={columns} rowKey={(r) => r.key} /> : <p className="text-sm text-muted-foreground">No data.</p>}
      </CardContent>
    </Card>
  );
}

/** Totals, daily cost chart, and breakdowns by model and role. */
export function OverviewPage({ since }: { since: string }) {
  const state = useApi<Overview>("/api/overview", { since });
  return (
    <StatusView state={state} isEmpty={(d) => d.total.requests === 0}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Estimated cost" value={<Cost usd={d.total.cost_usd} />} hint={d.total.unpriced ? `${fmtInt(d.total.unpriced)} requests with unknown pricing excluded` : undefined} />
            <Kpi label="Requests" value={fmtInt(d.total.requests)} />
            <Kpi label="Input tokens" value={fmtTokens(d.total.input)} />
            <Kpi label="Output tokens" value={fmtTokens(d.total.output)} />
            <Kpi label="Cache tokens" value={fmtTokens(d.total.cache_read + d.total.cache_write)} hint={`${fmtTokens(d.total.cache_read)} read · ${fmtTokens(d.total.cache_write)} write`} />
          </div>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle>Cost per day (est.)</CardTitle>
              <CardDescription>{COST_NOTE}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                <BarChart data={[...d.byDay].reverse()}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtUsd(v)} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v) => `${fmtUsd(Number(v))} est.`} />} />
                  <Bar dataKey="cost_usd" fill="var(--color-cost_usd)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <UsageCard title="By model" keyHead="Model" rows={d.byModel} />
          <UsageCard title="By role" keyHead="Role" rows={d.byRole} />
        </>
      )}
    </StatusView>
  );
}
