import { useMemo } from "react";
import { COST_NOTE } from "@/components/cost.label.tsx";
import { RangePicker } from "@/components/range.picker.tsx";
import { SyncIndicator } from "@/components/sync.indicator.tsx";
import { ThemeToggle } from "@/components/theme.toggle.tsx";
import { cn } from "@/lib/cn.ts";
import { hashHref, useHashRoute, withParams } from "@/lib/hash.route.ts";
import { DEFAULT_RANGE, parseRange, sinceFor, type Range } from "@/lib/range.ts";
import { useSyncMeta, withPollError } from "@/lib/sync.meta.ts";
import { OverviewPage } from "@/pages/overview.page.tsx";
import { ProjectsPage } from "@/pages/projects.page.tsx";
import { SessionsPage } from "@/pages/sessions.page.tsx";
import { SessionDetailPage } from "@/pages/session-detail.page.tsx";
import { RolesPage } from "@/pages/roles.page.tsx";
import { LivePage } from "@/pages/live.page.tsx";

/** Shared by header, main and footer so their left/right edges line up exactly. */
const CONTAINER = "mx-auto w-full max-w-[1280px] px-4 sm:px-6";
/** The dashboard server only binds loopback (see dashboard.command.ts). */
const LOCAL_NOTE = "Local only · 127.0.0.1";

const NAV = [
  { path: "/", label: "Overview", match: (p: string) => p === "/" },
  { path: "/projects", label: "Projects", match: (p: string) => p.startsWith("/projects") },
  { path: "/sessions", label: "Sessions", match: (p: string) => p.startsWith("/sessions") },
  { path: "/roles", label: "Roles", match: (p: string) => p.startsWith("/roles") },
  { path: "/live", label: "Live", match: (p: string) => p.startsWith("/live") },
];

/** URL value for a range; the default is omitted so clean URLs stay clean. */
const rangeParam = (r: Range) => (r === DEFAULT_RANGE ? undefined : r);

/** Dashboard shell: sticky header (nav, sync status, URL-backed range, theme), page switch, footer. */
export function App() {
  const route = useHashRoute();
  const { path, params } = route;
  const { meta, error, dataVersion } = useSyncMeta();
  const range = parseRange(params.get("range"));
  // dataVersion moves the window forward when new data lands, so "last 24h" stays current.
  const since = useMemo(() => sinceFor(range), [range, dataVersion]);
  const sessionId = path.match(/^\/sessions\/(.+)$/)?.[1];
  const timeless = !!sessionId || path.startsWith("/live");

  let page;
  if (sessionId) page = <SessionDetailPage id={decodeURIComponent(sessionId)} />;
  else if (path === "/projects") page = <ProjectsPage since={since} />;
  else if (path === "/sessions") page = <SessionsPage since={since} range={range} dataVersion={dataVersion} params={params} />;
  else if (path === "/roles") page = <RolesPage since={since} />;
  else if (path === "/live") page = <LivePage />;
  else if (path === "/") page = <OverviewPage since={since} range={range} dataVersion={dataVersion} tiers={meta?.tiers} />;
  else page = <p className="text-sm text-muted-foreground">Page not found.</p>;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        {/* <640: row 1 = logo · sync · theme, row 2 = nav (scrolls) · range. ≥640: one h-12 row. */}
        <div className={cn(CONTAINER, "flex flex-wrap items-center gap-x-4 gap-y-2 py-2 sm:h-12 sm:flex-nowrap sm:py-0")}>
          <a href={hashHref("/", { range: rangeParam(range) })} className="order-1 flex shrink-0 items-center gap-2 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-brand" />
            <span className="font-mono text-[13px] font-semibold">claude-manager</span>
          </a>
          <nav aria-label="Main" className="order-5 -mx-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1 sm:order-2">
            {NAV.map((n) => {
              const active = n.match(path);
              return (
                <a
                  key={n.path}
                  href={hashHref(n.path, { range: rangeParam(range) })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[13px] whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-ring",
                    active ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.label}
                </a>
              );
            })}
          </nav>
          <div className="order-2 ml-auto sm:order-3">
            <SyncIndicator meta={withPollError(meta, error)} now={Date.now()} />
          </div>
          <div aria-hidden className="order-4 basis-full sm:hidden" />
          <div className="order-6 sm:order-4">
            <RangePicker
              value={range}
              disabled={timeless}
              onChange={(r) => {
                // Keep path and other params; a new range invalidates the current page number.
                location.hash = withParams(route, { range: rangeParam(r), page: undefined });
              }}
            />
          </div>
          <div className="order-3 sm:order-5">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={cn(CONTAINER, "flex flex-col gap-6 py-6")}>{page}</main>
      <footer className="mt-auto border-t">
        <div className={cn(CONTAINER, "flex flex-wrap justify-between gap-x-6 gap-y-1 py-4 text-xs text-fg-subtle")}>
          <span>Costs · {COST_NOTE}</span>
          <span>{LOCAL_NOTE}</span>
        </div>
      </footer>
    </div>
  );
}
