import { useEffect, useState, type ReactNode } from "react";
import { Check, TriangleAlert, type LucideIcon } from "lucide-react";
import type { SessionRow } from "../../server/dashboard.types.ts";
import type { SessionDetailFull } from "../../server/session.detail.types.ts";
import { ContextBar } from "@/components/context.bar.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { KpiCard } from "@/components/kpi.card.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { RerouteChip } from "@/components/reroute.badge.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { SessionStatusBadge } from "@/components/status.badge.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { fmtSpan } from "@/lib/detail.format.ts";
import { cacheHitRate, fmtInt, fmtPct, fmtProject, fmtTime, fmtTokens } from "@/lib/format.ts";
import { KPI_ICON, NAV_ICON, UI_ICON } from "@/lib/icon.map.ts";
import { useNow } from "@/lib/now.ts";

/** Characters of the session id shown next to the copy button. */
const SHORT_ID_CHARS = 8;
/** How long the "Copied" / "Copy failed" feedback stays. */
const COPY_FEEDBACK_MS = 2000;

function CopyId({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setState("copied");
    } catch (e) {
      console.warn(`copy session id ${id} failed`, e);
      setState("failed");
    }
  };
  const Icon = state === "copied" ? Check : state === "failed" ? TriangleAlert : UI_ICON.copy;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground" title={id}>
      #{id.slice(0, SHORT_ID_CHARS)}
      <button type="button" onClick={copy} aria-label="Copy session id" className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-sm:size-11">
        <Icon aria-hidden className="size-3.5" />
      </button>
      <span role="status" className="font-sans">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}</span>
    </span>
  );
}

function Meta({ icon: Icon, title, children }: { icon: LucideIcon; title?: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground" title={title}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="break-all">{children}</span>
    </span>
  );
}

/** Back link, wrapping title and the meta row (status, project, branch, role, models, time span, short id). */
export function SessionHeader({ session: s, models, roles }: Pick<SessionDetailFull, "session" | "models"> & { roles?: readonly RoleMeta[] }) {
  const now = useNow();
  const model = s.model ?? models[0]?.key;
  return (
    <header className="flex flex-col gap-2">
      <a href="#/sessions" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <UI_ICON.back aria-hidden className="size-4" />
        Sessions
      </a>
      <h1 className="flex items-start gap-2 text-xl font-semibold tracking-[-0.01em] break-words">
        <NAV_ICON.sessions aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">{s.title ?? s.id}</span>
      </h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SessionStatusBadge lastTs={s.last_ts} now={now} />
        {s.project_cwd && <Meta icon={UI_ICON.project} title={s.project_cwd}>{fmtProject(s.project_cwd)}</Meta>}
        {s.git_branch && <Meta icon={UI_ICON.branch}>{s.git_branch}</Meta>}
        <RoleBadge role={s.main_agent ?? "main"} roles={roles} />
        {model && <ModelBadge model={model} extra={s.models > 1 ? `+${s.models - 1}` : undefined} />}
        {s.rerouted > 0 && <RerouteChip count={s.rerouted} />}
        <Meta icon={UI_ICON.time}>
          Started {fmtTime(s.first_ts)} · active <RelativeTime iso={s.last_ts} /> · {fmtSpan(s.first_ts, s.last_ts)} long
        </Meta>
        <CopyId id={s.id} />
      </div>
    </header>
  );
}

const plural = (n: number, word: string) => `${fmtInt(n)} ${word}${n === 1 ? "" : "s"}`;

/** Four KPI cards (cost, requests, tokens, agents) plus the context meter when the window is known. */
export function SessionKpis({ session: s, compactions, context }: { session: SessionRow } & Pick<SessionDetailFull, "compactions" | "context">) {
  const tokens = s.input + s.output + s.cache_read + s.cache_write;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={KPI_ICON.cost} label="Cost (est.)" value={<CostCell usd={s.cost_usd} unpriced={s.unpriced} />} />
        <KpiCard icon={KPI_ICON.requests} label="Requests" value={fmtInt(s.requests)} />
        <KpiCard icon={KPI_ICON.tokens} label="Tokens" value={fmtTokens(tokens)} hint={`Cache hit ${fmtPct(cacheHitRate(s))}`} />
        <KpiCard icon={KPI_ICON.agents} label="Agents" value={fmtInt(s.agents)} hint={plural(compactions, "compaction")} />
      </div>
      {context && (
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-muted-foreground">Context</span>
          <div className="min-w-0 flex-1"><ContextBar used={context.used} window={context.window} size="md" /></div>
        </div>
      )}
    </>
  );
}
