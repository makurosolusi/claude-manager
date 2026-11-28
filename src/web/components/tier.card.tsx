import { Crown } from "lucide-react";
import { CostCell } from "@/components/cost.cell.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { AgentRow } from "../../server/agents.types.ts";
import type { TierSummary } from "../../server/tiers.types.ts";
import { FAMILY_CLASSES, TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { fmtInt, plural } from "@/lib/format.ts";
import { TIER_ALIAS } from "@/lib/agents.hierarchy.ts";
import { TIER_ICON, UI_ICON } from "@/lib/icon.map.ts";
import { modelFamily, tierFamily, type Tier } from "@/lib/model.tier.ts";
import { fmtPrice } from "@/lib/tier.models.ts";

const MAX_CHIPS = 8;
const MAX_CHIPS_NARROW = 4;
const FOCUS = "outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";

interface Props {
  tier: Tier;
  /** Server summary; undefined while tiers load, then the card falls back to the agents' own data. */
  summary?: TierSummary;
  agents: AgentRow[];
  price?: { input: number | null; output: number | null };
  newer: string | null;
  write: boolean;
  onEdit: (tier: Tier, preselect?: string) => void;
}

/** One tier lane: icon, alias, configured model, price, 30-day usage, a newer-model hint and the agents routed through it. */
export function TierCard({ tier, summary, agents, price, newer, write, onEdit }: Props) {
  const Icon = TIER_ICON[tier];
  const alias = TIER_ALIAS[tier];
  const model = summary?.model ?? agents.find((a) => a.model_id)?.model_id ?? null;
  const family = FAMILY_CLASSES[model ? modelFamily(model) : tierFamily(tier)];
  const hint = [summary?.env, !write && model ? `Change with claude-manager tier set ${tier} <model-id>` : null].filter(Boolean).join(" · ");
  const extra = (n: number) => (agents.length > n ? agents.length - n : 0);
  return (
    <article aria-label={`${tier[0]!.toUpperCase()}${tier.slice(1)} tier`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <header className="flex items-center gap-2">
        <Icon aria-hidden className={cn("size-4 shrink-0", family.text)} />
        <h3 className="text-sm font-semibold capitalize">{tier}</h3>
        <span className="rounded-sm border border-border px-1.5 font-mono text-xs text-muted-foreground">{alias}</span>
        {write && (
          <Button type="button" size="sm" variant="outline" className={cn("ml-auto min-h-9", FOCUS)} onClick={() => onEdit(tier)}>
            <UI_ICON.edit aria-hidden />Edit
          </Button>
        )}
      </header>
      <div className="flex flex-col gap-1">
        <span title={hint || undefined} className={cn("truncate font-mono text-sm", family.text)}>{model ?? "—"}</span>
        <span className="text-xs text-muted-foreground">{summary ? fmtPrice(price?.input ?? null, price?.output ?? null) : "—"}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {plural(agents.length, "agent")}
          {summary ? (
            <> · {fmtInt(summary.requests_30d)} req · <CostCell usd={summary.cost_30d} unpriced={summary.unpriced_30d} /> / 30d</>
          ) : " · — req · —"}
        </span>
        {newer && (write ? (
          <button type="button" onClick={() => onEdit(tier, newer)} className={cn("w-fit rounded-sm border px-1.5 font-mono text-xs", TONE_CLASSES.info.badge, FOCUS)}>
            Newer: {newer}
          </button>
        ) : (
          <span className={cn("w-fit rounded-sm border px-1.5 font-mono text-xs", TONE_CLASSES.info.badge)}>Newer: {newer}</span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {agents.slice(0, MAX_CHIPS).map((a, i) => (
          <li key={a.name} className={cn("flex items-center gap-1", a.status === "disabled" && "opacity-60", i >= MAX_CHIPS_NARROW && "max-sm:hidden")}>
            {a.main_agent && <Crown aria-label="Main agent" className="size-3.5 shrink-0" />}
            <a href={`#/agents/${encodeURIComponent(a.name)}`} className={cn("rounded-sm", FOCUS)}><RoleBadge role={a.name} /></a>
          </li>
        ))}
        {extra(MAX_CHIPS_NARROW) > 0 && <li className="text-xs text-muted-foreground sm:hidden">+{extra(MAX_CHIPS_NARROW)}</li>}
        {extra(MAX_CHIPS) > 0 && <li className="text-xs text-muted-foreground max-sm:hidden">+{extra(MAX_CHIPS)}</li>}
      </ul>
    </article>
  );
}
