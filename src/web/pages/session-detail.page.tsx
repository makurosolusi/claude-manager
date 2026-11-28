import { useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import { TriangleAlert } from "lucide-react";
import type { SessionDetailFull } from "../../server/session.detail.types.ts";
import { RequestsTable } from "@/components/requests.table.tsx";
import { SessionHeader, SessionKpis } from "@/components/session.summary.tsx";
import { SessionAgentsTable } from "@/components/session.agents.table.tsx";
import { ModelsPanel, RolesPanel, ToolsPanel } from "@/components/session.panels.tsx";
import { SessionTabs, type SessionTabDef } from "@/components/session.tabs.tsx";
import { Timeline } from "@/components/timeline.view.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useApi } from "@/lib/api.client.ts";
import { SESSIONS_PATH } from "@/lib/sessions.query.ts";
import { KPI_ICON, UI_ICON } from "@/lib/icon.map.ts";
import { parseTab, tabHref } from "@/lib/session.tabs.ts";

/** Marker `getJson` puts in the error message of a 404 response. */
const NOT_FOUND_MARKER = "(404)";

const BackLink = () => (
  <a href="#/sessions" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
    ‹ Sessions
  </a>
);

function Skeleton() {
  return (
    <div aria-busy className="flex flex-col gap-4" role="status" aria-label="Loading session">
      <div className="h-7 w-2/3 animate-pulse rounded-sm bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

const tabs = (requests: number, agents: number): SessionTabDef[] => [
  { id: "requests", label: "Requests", icon: KPI_ICON.requests, count: requests },
  { id: "agents", label: "Agents", icon: KPI_ICON.agents, count: agents },
  { id: "prompts", label: "Prompts", icon: UI_ICON.prompt },
];

/** Shell page props plus the session id; uses the id, the data version (live refresh) and the role roster. */
type Props = PageProps & { id: string };

/** One session: header, KPIs, a capped summary row (models, tools, roles) and one tabbed list at a time (requests, agents, prompts). */
export function SessionDetailPage({ id, dataVersion, roles, params }: Props) {
  const [retry, setRetry] = useState(0);
  const { data, error } = useApi<SessionDetailFull>(`/api/sessions/${encodeURIComponent(id)}`, {}, retry + dataVersion);

  if (!data && error) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {error.message.includes(NOT_FOUND_MARKER) ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Session not found. <a href="#/sessions" className="underline">Back to sessions</a></p>
        ) : (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 p-3 text-sm">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0 break-words">Couldn't load this session. {error.message}</span>
            <Button size="xs" variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry</Button>
          </div>
        )}
      </div>
    );
  }
  if (!data) return <Skeleton />;

  const { session, agents, models, tools, compactions, context } = data;
  const tab = parseTab(params.get("tab"));
  const path = `${SESSIONS_PATH}/${encodeURIComponent(id)}`;
  return (
    <div className="flex flex-col gap-6">
      <SessionHeader session={session} models={models} roles={roles} />
      <SessionKpis session={session} compactions={compactions} context={context} />
      <div className="grid items-start gap-4 md:grid-cols-3">
        <ModelsPanel models={models} />
        <ToolsPanel tools={tools} />
        <RolesPanel agents={agents} roles={roles} />
      </div>
      <SessionTabs tabs={tabs(session.requests, agents.length)} active={tab} onChange={(t) => (location.hash = tabHref({ path, params }, t))}>
        {tab === "requests" && <RequestsTable sessionId={session.id} roles={roles} tick={dataVersion} />}
        {tab === "agents" && <SessionAgentsTable agents={agents} roles={roles} path={path} params={params} />}
        {tab === "prompts" && <Timeline sessionId={session.id} tick={dataVersion} />}
      </SessionTabs>
    </div>
  );
}
