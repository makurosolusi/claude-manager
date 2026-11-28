import type { ReactNode } from "react";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { ReroutedCount } from "@/components/reroute.badge.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { AgentLink, NameReroute } from "@/components/roles.columns.tsx";
import { ShareBar } from "@/components/share.bar.tsx";
import { TierBadge } from "@/components/tier.badge.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { fmtInt, fmtModel, fmtTokens } from "@/lib/format.ts";
import type { Tiers } from "@/lib/model.tier.ts";
import { cacheHitLabel, sumRerouted, sumUsage, type TieredRow } from "@/lib/roles.aggregate.ts";
import { groupRows, type RolesView } from "@/lib/roles.view.ts";

export interface GroupCtx {
  view: RolesView;
  roles?: readonly RoleMeta[];
  tiers?: Partial<Tiers>;
  /** Share of the overall cost (0..1) for a usage subtotal. */
  share: (u: { cost_usd: number }) => number;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

function label(key: string, rows: TieredRow[], c: GroupCtx): ReactNode {
  const mark = <NameReroute count={sumRerouted(rows)} total={sumUsage(rows).requests} />;
  if (c.view === "role") return <span className="inline-flex items-center gap-2"><RoleBadge role={key} roles={c.roles} />{mark}</span>;
  if (c.view === "model") return <span className="inline-flex items-center gap-2"><ModelBadge model={key} />{mark}</span>;
  const tier = rows[0]!.tier;
  const model = tier === "other" ? undefined : c.tiers?.[tier];
  return (
    <span className="inline-flex items-center gap-2">
      <TierBadge tier={rows[0]!.tier} tiers={c.tiers} />
      {model && <span className="font-mono text-xs text-muted-foreground">{fmtModel(model)}</span>}
      {mark}
    </span>
  );
}

/** One collapsible group per role / model / tier; the group row is the subtotal of its rows. */
export function roleGroups(rows: readonly TieredRow[], c: GroupCtx): GroupSpec<TieredRow>[] {
  return groupRows(rows, c.view).map((g) => {
    const u = sumUsage(g.rows);
    return {
      key: g.key, label: label(g.key, g.rows, c), count: g.rows.length, rows: g.rows, open: c.isOpen(g.key), onToggle: () => c.toggle(g.key),
      action: c.view === "role" ? <AgentLink role={g.key} /> : undefined,
      totals: {
        requests: fmtInt(u.requests), tokens: fmtTokens(u.input + u.output + u.cache_read + u.cache_write), cache: cacheHitLabel(u),
        rerouted: <ReroutedCount count={sumRerouted(g.rows)} />, cost: <CostCell usd={u.cost_usd} unpriced={u.unpriced} />, share: <ShareBar share={c.share(u)} />,
      },
    };
  });
}
