import { ArrowLeftRight, ArrowUpRight } from "lucide-react";
import type { Tier, TierKey } from "@/lib/model.tier.ts";
import type { Usage } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import type { Column } from "@/components/data.table.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { ReroutedCount, RerouteMark } from "@/components/reroute.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { ShareBar } from "@/components/share.bar.tsx";
import { TokenCell } from "@/components/token.cell.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { fmtInt } from "@/lib/format.ts";
import { cacheHitLabel, configuredTierMismatch, type TieredRow } from "@/lib/roles.aggregate.ts";
import { agentHref, type RolesView } from "@/lib/roles.view.ts";

/** Requests, Tokens, Cache hit, Rerouted, Cost (est.) and Share; below sm only Requests and Cost stay. */
export function usageColumns<T extends Usage & { rerouted: number }>(share: (r: T) => number): Column<T>[] {
  return [
    { id: "requests", header: <span>Req<span className="max-sm:sr-only">uests</span></span>, cell: (r) => fmtInt(r.requests), align: "right", sortKey: "requests", width: "w-16 sm:w-20" },
    { id: "tokens", header: "Tokens", cell: (r) => <TokenCell usage={r} />, align: "right", sortKey: "tokens", width: "w-20", hideBelow: "sm" },
    { id: "cache", header: "Cache hit", cell: cacheHitLabel, align: "right", width: "w-20", hideBelow: "lg" },
    { id: "rerouted", header: "Rerouted", cell: (r) => <ReroutedCount count={r.rerouted} total={r.requests} />, align: "right", sortKey: "rerouted", width: "w-20", hideBelow: "lg" },
    { id: "cost", header: <span>Cost<span className="max-sm:sr-only"> (est.)</span></span>, cell: (r) => <CostCell usd={r.cost_usd} unpriced={r.unpriced} />, align: "right", sortKey: "cost", width: "w-20 sm:w-24" },
    { id: "share", header: "Share", cell: (r) => <ShareBar share={share(r)} />, align: "right", sortKey: "share", width: "w-32", hideBelow: "md" },
  ];
}

/** Reroute marker shown beside a name while the Rerouted column is hidden (below lg). */
export const NameReroute = ({ count, total }: { count: number; total: number }) => (
  <span className="lg:hidden"><RerouteMark count={count} total={total} /></span>
);

function TierHint({ role, tier, roles }: { role: string; tier: TierKey; roles?: readonly RoleMeta[] }) {
  const hint: Tier | undefined = configuredTierMismatch(role, tier, roles);
  if (!hint) return null;
  const note = `Configured for ${hint}, billed as ${tier}`;
  return <Tooltip focusable content={note}><ArrowLeftRight role="img" aria-label={note} className="size-3.5 text-muted-foreground" /></Tooltip>;
}

/** Icon button after a role group label, linking to the agent's page; renders nothing for main/subagent. */
export function AgentLink({ role }: { role: string }) {
  const href = agentHref(role);
  if (!href) return null;
  const note = `Open ${role} on the Agents page`;
  return (
    <Tooltip content={note}>
      <a href={href} aria-label={note} className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
        <ArrowUpRight aria-hidden className="size-3.5" />
      </a>
    </Tooltip>
  );
}

/** Name column(s) for a view: the child rows show the other dimension, indented under the group label. */
export function nameColumns(view: RolesView, roles?: readonly RoleMeta[]): Column<TieredRow>[] {
  const wrap = "inline-flex min-w-0 items-center gap-1.5";
  if (view === "tier") {
    return [
      {
        id: "role", header: "Role", sortKey: "role", width: "w-56", cell: (r) => (
          <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className={wrap}><RoleBadge role={r.role} roles={roles} /><TierHint role={r.role} tier={r.tier} roles={roles} /><NameReroute count={r.rerouted} total={r.requests} /></span>
            <span className="sm:hidden"><ModelBadge model={r.model} /></span>
          </span>
        ),
      },
      { id: "model", header: "Model", sortKey: "model", cell: (r) => <ModelBadge model={r.model} />, fill: true, hideBelow: "sm" },
    ];
  }
  const byRole = view === "role";
  return [
    {
      id: "name", header: byRole ? "Role / model" : "Model / role", sortKey: byRole ? "model" : "role", fill: true, cell: (r) => (
        <span className={`${wrap} pl-6`}>
          {byRole ? <ModelBadge model={r.model} /> : <RoleBadge role={r.role} roles={roles} />}
          <TierHint role={r.role} tier={r.tier} roles={roles} />
          <NameReroute count={r.rerouted} total={r.requests} />
        </span>
      ),
    },
  ];
}

/** Plain-text column names for the View menu (the Requests and Cost headers shorten below sm). */
export const columnLabel = (c: Column<TieredRow>): string => ({ requests: "Requests", cost: "Cost (est.)" })[c.id as "requests" | "cost"] ?? String(c.header);
