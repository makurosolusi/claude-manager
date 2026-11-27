import { useEffect, useState } from "react";
import type { LiveSession } from "../../server/dashboard.types.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { StatusView } from "@/components/status.view.tsx";
import { Cost } from "@/components/cost.label.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtTime, fmtTokens, shortPath } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";

/** How often the Live page re-polls /api/live. */
export const LIVE_REFRESH_MS = 5_000;
/** Below this share of context left, the bar turns red. */
const LOW_CONTEXT_PCT = 20;

/** Active sessions with remaining context, auto-refreshed. */
export function LivePage() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const state = useApi<LiveSession[]>("/api/live", {}, tick);
  return (
    <>
      <p className="text-sm text-muted-foreground">Refreshes every {LIVE_REFRESH_MS / 1000}s.</p>
      <StatusView state={state} isEmpty={(d) => d.length === 0} emptyText="No active sessions right now.">
        {(d) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.map((s) => (
              <a key={s.id} href={hashHref(`/sessions/${encodeURIComponent(s.id)}`)} className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full gap-3 py-4 hover:bg-accent/50">
                  <CardHeader className="px-4">
                    <CardTitle className="truncate" title={s.title ?? s.id}>
                      {s.title ?? s.id}
                    </CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-2">
                      <span title={s.project_cwd ?? ""}>{shortPath(s.project_cwd)}</span>
                      <Badge variant="secondary">{s.model}</Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 px-4 text-sm">
                    <div className="flex justify-between">
                      <span>{Math.round(s.context_left_pct)}% context left</span>
                      <span className="text-muted-foreground">
                        {fmtTokens(s.context_used)} / {fmtTokens(s.context_window)}
                      </span>
                    </div>
                    <Progress value={s.context_left_pct} indicatorClassName={s.context_left_pct < LOW_CONTEXT_PCT ? "bg-destructive" : undefined} />
                    <div className="flex justify-between text-muted-foreground">
                      <span>{fmtTime(s.last_ts)}</span>
                      <Cost usd={s.cost_usd} />
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        )}
      </StatusView>
    </>
  );
}
