import type { ReactNode } from "react";
import type { SessionDetail } from "../../server/dashboard.types.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { StatusView } from "@/components/status.view.tsx";
import { Cost } from "@/components/cost.label.tsx";
import { AgentTree } from "@/components/agent.tree.view.tsx";
import { Timeline } from "@/components/timeline.view.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtTime, fmtTokens } from "@/lib/format.ts";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-all">{children}</dd>
    </div>
  );
}

/** One session: summary, subagent tree, and prompt timeline. */
export function SessionDetailPage({ id }: { id: string }) {
  const state = useApi<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
  return (
    <>
      <a href="#/sessions" className="text-sm text-muted-foreground hover:underline">
        ← Sessions
      </a>
      <StatusView state={state}>
        {({ session: s, agents }) => (
          <>
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="break-words">{s.title ?? s.id}</CardTitle>
                <CardDescription className="break-all">{s.id}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <Field label="Project">{s.project_cwd ?? "—"}</Field>
                  <Field label="Branch">{s.git_branch ?? "—"}</Field>
                  <Field label="Main agent">{s.main_agent ?? "main"}</Field>
                  <Field label="Active">
                    {fmtTime(s.first_ts)} → {fmtTime(s.last_ts)}
                  </Field>
                  <Field label="Requests">{fmtInt(s.requests)}</Field>
                  <Field label="Tokens in / out">
                    {fmtTokens(s.input)} / {fmtTokens(s.output)}
                  </Field>
                  <Field label="Cache read / write">
                    {fmtTokens(s.cache_read)} / {fmtTokens(s.cache_write)}
                  </Field>
                  <Field label="Cost">
                    <Cost usd={s.cost_usd} />
                  </Field>
                </dl>
              </CardContent>
            </Card>
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Subagents ({agents.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <AgentTree agents={agents} />
              </CardContent>
            </Card>
            <Card className="gap-2">
              <CardHeader>
                <CardTitle>Prompts</CardTitle>
              </CardHeader>
              <CardContent>
                <Timeline sessionId={s.id} />
              </CardContent>
            </Card>
          </>
        )}
      </StatusView>
    </>
  );
}
