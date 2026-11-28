import { useMemo } from "react";
import { COST_NOTE } from "@/components/cost.cell.tsx";
import { RangePicker } from "@/components/range.picker.tsx";
import { SyncIndicator } from "@/components/sync.indicator.tsx";
import { ThemeToggle } from "@/components/theme.toggle.tsx";
import { cn } from "@/lib/cn.ts";
import { NAV_ICON } from "@/lib/icon.map.ts";
import { hashHref, useHashRoute, withParams } from "@/lib/hash.route.ts";
import { SECOND_TICK_MS, useNow } from "@/lib/now.ts";
import { DEFAULT_RANGE, parseRange, sinceFor, type Range } from "@/lib/range.ts";
import type { SyncMeta } from "../server/dashboard.types.ts";
import { useSyncMeta, withPollError } from "@/lib/sync.meta.ts";
import { OverviewPage } from "@/pages/overview.page.tsx";
import { ProjectsPage } from "@/pages/projects.page.tsx";
import { SessionsPage } from "@/pages/sessions.page.tsx";
import { SessionDetailPage } from "@/pages/session-detail.page.tsx";
import { AgentsPage } from "@/pages/agents.page.tsx";
import { AgentDetailPage } from "@/pages/agent-detail.page.tsx";
import { RolesPage } from "@/pages/roles.page.tsx";
import { LivePage } from "@/pages/live.page.tsx";
import { PolicyPage } from "@/pages/policy.page.tsx";
import { PolicyAuditPage } from "@/pages/policy-audit.page.tsx";

/** Shared by header, main and footer so their left/right edges line up exactly. */
const CONTAINER = "mx-auto w-full max-w-[1280px] px-4 sm:px-6";
/** The dashboard server only binds loopback (see dashboard.command.ts). */
const LOCAL_NOTE = "Local only · 127.0.0.1";

const NAV = [
  { path: "/", label: "Overview", icon: NAV_ICON.overview, match: (p: string) => p === "/" },
  { path: "/projects", label: "Projects", icon: NAV_ICON.projects, match: (p: string) => p.startsWith("/projects") },
  { path: "/sessions", label: "Sessions", icon: NAV_ICON.sessions, match: (p: string) => p.startsWith("/sessions") },
  { path: "/agents", label: "Agents", icon: NAV_ICON.agents, match: (p: string) => p.startsWith("/agents") || p.startsWith("/policy") },
  { path: "/roles", label: "Roles", icon: NAV_ICON.roles, match: (p: string) => p.startsWith("/roles") },
  { path: "/live", label: "Live", icon: NAV_ICON.live, match: (p: string) => p.startsWith("/live") },
];

/** URL value for a range; the default is omitted so clean URLs stay clean. */
const rangeParam = (r: Range) => (r === DEFAULT_RANGE ? undefined : r);

/** Sync status with its own 1s clock, so "Synced Ns ago" ticks between polls without re-rendering the whole shell. */
function HeaderSync({ meta }: { meta: SyncMeta | undefined }) {
  return <SyncIndicator meta={meta} now={useNow(SECOND_TICK_MS)} />;
}

/** Dashboard shell: sticky header (nav, sync status, URL-backed range, theme), page switch, footer. */
export function App() {
  const route = useHashRoute();
  const { path, params } = route;
  const { meta, error, dataVersion } = useSyncMeta();
  const range = parseRange(params.get("range"));
  // dataVersion moves the window forward when new data lands, so "last 24h" stays current.
  const since = useMemo(() => sinceFor(range), [range, dataVersion]);
  const { tiers, roles } = meta ?? {};
  const sessionId = path.match(/^\/sessions\/(.+)$/)?.[1];
  const agentName = path.match(/^\/agents\/(.+)$/)?.[1];
  const timeless = !!sessionId || path.startsWith("/live") || path.startsWith("/agents") || path.startsWith("/policy");

  let page;
  if (sessionId) page = <SessionDetailPage id={decodeURIComponent(sessionId)} since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/projects") page = <ProjectsPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/sessions") page = <SessionsPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (agentName) page = <AgentDetailPage name={decodeURIComponent(agentName)} since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/agents") page = <AgentsPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/policy") page = <PolicyPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/policy/audit") page = <PolicyAuditPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/roles") page = <RolesPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/live") page = <LivePage range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else if (path === "/") page = <OverviewPage since={since} range={range} dataVersion={dataVersion} params={params} tiers={tiers} roles={roles} />;
  else page = <p className="text-sm text-muted-foreground">Page not found.</p>;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-30 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:outline-2 focus:outline-solid focus:outline-ring">Skip to content</a>
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        {/* <640: row 1 = logo · sync · range · theme, row 2 = 6-column nav (all links visible, 48px targets). ≥640: one h-12 row. */}
        <div className={cn(CONTAINER, "flex flex-wrap items-center gap-x-3 gap-y-0 sm:h-12 sm:flex-nowrap sm:gap-x-4")}>
          <a href={hashHref("/", { range: rangeParam(range) })} className="order-1 flex min-h-11 shrink-0 items-center gap-2 rounded-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring sm:min-h-0">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-brand" />
            <span className="font-mono text-[13px] font-semibold">claude-manager</span>
          </a>
          <nav aria-label="Main" className="order-5 -mx-4 grid basis-full grid-cols-6 sm:order-2 sm:mx-0 sm:flex sm:min-w-0 sm:flex-1 sm:basis-0 sm:gap-0.5">
            {NAV.map((n) => {
              const active = n.match(path);
              return (
                <a
                  key={n.path}
                  href={hashHref(n.path, { range: rangeParam(range) })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring sm:inline-flex sm:min-h-0 sm:flex-row sm:gap-1.5 sm:rounded-md sm:px-2.5 sm:py-1 sm:text-[13px] sm:whitespace-nowrap",
                    active ? "text-foreground before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-foreground sm:bg-surface-hover sm:before:hidden" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <n.icon aria-hidden className="size-4 sm:size-3.5" />
                  {n.label}
                </a>
              );
            })}
          </nav>
          <div className="order-2 ml-auto sm:order-3">
            <HeaderSync meta={withPollError(meta, error)} />
          </div>
          <div className="order-3 sm:order-4">
            <RangePicker
              value={range}
              disabled={timeless}
              onChange={(r) => {
                // Keep path and other params; a new range invalidates the current page number.
                location.hash = withParams(route, { range: rangeParam(r), page: undefined });
              }}
            />
          </div>
          <div className="order-4 sm:order-5">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={cn(CONTAINER, "flex flex-col gap-6 py-6 outline-hidden")}>{page}</main>
      <footer className="mt-auto border-t">
        <div className={cn(CONTAINER, "flex flex-wrap justify-between gap-x-6 gap-y-1 py-4 text-xs text-fg-subtle")}>
          <span>Costs · {COST_NOTE}</span>
          <span>{LOCAL_NOTE}</span>
        </div>
      </footer>
    </div>
  );
}
