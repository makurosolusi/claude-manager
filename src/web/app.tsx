import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { COST_NOTE } from "@/components/cost.label.tsx";
import { cn } from "@/lib/cn.ts";
import { useHashRoute } from "@/lib/hash.route.ts";
import { DEFAULT_RANGE, RANGES, sinceFor, type Range } from "@/lib/range.ts";
import { OverviewPage } from "@/pages/overview.page.tsx";
import { ProjectsPage } from "@/pages/projects.page.tsx";
import { SessionsPage } from "@/pages/sessions.page.tsx";
import { SessionDetailPage } from "@/pages/session-detail.page.tsx";
import { RolesPage } from "@/pages/roles.page.tsx";
import { LivePage } from "@/pages/live.page.tsx";

const NAV = [
  { href: "#/", label: "Overview", match: (p: string) => p === "/" },
  { href: "#/projects", label: "Projects", match: (p: string) => p.startsWith("/projects") },
  { href: "#/sessions", label: "Sessions", match: (p: string) => p.startsWith("/sessions") },
  { href: "#/roles", label: "Roles", match: (p: string) => p.startsWith("/roles") },
  { href: "#/live", label: "Live", match: (p: string) => p.startsWith("/live") },
];

/** Dashboard shell: header nav, global time range, and hash-based page switch. */
export function App() {
  const { path, params } = useHashRoute();
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const since = useMemo(() => sinceFor(range), [range]);
  const sessionId = path.match(/^\/sessions\/(.+)$/)?.[1];
  const showRange = !sessionId && !path.startsWith("/live");

  let page;
  if (sessionId) page = <SessionDetailPage id={decodeURIComponent(sessionId)} />;
  else if (path === "/projects") page = <ProjectsPage since={since} />;
  else if (path === "/sessions") page = <SessionsPage since={since} project={params.get("project") ?? ""} />;
  else if (path === "/roles") page = <RolesPage since={since} />;
  else if (path === "/live") page = <LivePage />;
  else if (path === "/") page = <OverviewPage since={since} />;
  else page = <p className="text-sm text-muted-foreground">Page not found.</p>;

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href="#/" className="font-semibold">
          claude-manager
        </a>
        <nav className="-mx-1 flex gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm whitespace-nowrap hover:bg-accent",
                n.match(path) ? "bg-accent font-medium" : "text-muted-foreground",
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
        {showRange && (
          <div className="ml-auto flex gap-1" role="group" aria-label="Time range">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <Button key={r} size="xs" variant={r === range ? "default" : "outline"} aria-pressed={r === range} onClick={() => setRange(r)}>
                {r}
              </Button>
            ))}
          </div>
        )}
      </header>
      <main className="flex flex-col gap-4">{page}</main>
      <footer className="mt-auto pt-4 text-xs text-muted-foreground">"est." — {COST_NOTE}</footer>
    </div>
  );
}
