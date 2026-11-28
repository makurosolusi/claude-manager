import { ArrowRight, Crown, UserRound } from "lucide-react";
import { useId, useState } from "react";
import type { AgentRow } from "../../server/agents.types.ts";
import type { TiersResponse } from "../../server/tiers.types.ts";
import { RoleBadge } from "@/components/role.badge.tsx";
import { TierCard } from "@/components/tier.card.tsx";
import { buildHierarchy, TIER_LIST } from "@/lib/agents.hierarchy.ts";
import { FAMILY_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { TIER_ICON } from "@/lib/icon.map.ts";
import { modelFamily, tierFamily, type Tier } from "@/lib/model.tier.ts";
import { newerInFamily, normalizeModelId } from "@/lib/tier.models.ts";

interface Props {
  items: AgentRow[];
  tiers: TiersResponse | undefined;
  write: boolean;
  onEdit: (tier: Tier, preselect?: string) => void;
}

const NODE = "flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm";

function MainNode({ a, multiple }: { a: AgentRow; multiple: boolean }) {
  const Icon = a.tier ? TIER_ICON[a.tier] : TIER_ICON.other;
  const family = FAMILY_CLASSES[a.model_id ? modelFamily(a.model_id) : tierFamily(a.tier ?? "other")];
  return (
    <div className={NODE} title={multiple ? "Main agent in at least one install" : undefined}>
      <Crown aria-hidden className="size-4 shrink-0" />
      <a href={`#/agents/${encodeURIComponent(a.name)}`}><RoleBadge role={a.name} /></a>
      <Icon aria-hidden className={cn("size-4 shrink-0", family.text)} />
      <span className={cn("truncate font-mono text-xs", family.text)}>{[a.alias, a.model_id].filter((v, i, r) => v && r.indexOf(v) === i).join(" → ") || "inherit"}</span>
    </div>
  );
}

function Chips({ agents }: { agents: AgentRow[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {agents.map((a) => (
        <li key={a.name} className={a.status === "disabled" ? "opacity-60" : undefined}>
          <a href={`#/agents/${encodeURIComponent(a.name)}`}><RoleBadge role={a.name} /></a>
        </li>
      ))}
    </ul>
  );
}

function Lane({ title, agents }: { title: string; agents: AgentRow[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <Chips agents={agents} />
    </div>
  );
}

/** One collapsible lane (one heading for screen readers): open on sm+ screens, closed on phones. */
function Unmanaged({ agents }: { agents: AgentRow[] }) {
  const [open, setOpen] = useState(() => typeof matchMedia === "function" && matchMedia("(min-width: 40rem)").matches);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="flex flex-col gap-1.5">
      <summary className="cursor-pointer rounded-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
        <h3 className="inline text-xs font-medium text-muted-foreground">Not managed ({agents.length})</h3>
      </summary>
      <div className="mt-1.5"><Chips agents={agents} /></div>
    </details>
  );
}

/** Owner → main agent → per-tier lanes, with pinned and unmanaged agents below. */
export function AgentsHierarchy({ items, tiers, write, onEdit }: Props) {
  const id = useId();
  const h = buildHierarchy(items);
  const loading = !tiers && items.length === 0;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold">Hierarchy</h2>
      <div className="flex flex-wrap items-center gap-3">
        <div className={NODE}><UserRound aria-hidden className="size-4 shrink-0" />You (owner)</div>
        <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
        {h.mains.length ? (
          <div className="flex flex-col gap-2">{h.mains.map((a) => <MainNode key={a.name} a={a} multiple={h.mains.length > 1} />)}</div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            <p>No main agent. Sessions start as plain Claude Code and delegate to agents by their description.</p>
            <code className="font-mono text-xs">claude-manager install --main-agent manager</code>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {TIER_LIST.map((t) => {
          const summary = tiers?.tiers.find((s) => s.tier === t);
          const price = summary && tiers?.models.find((m) => m.id === normalizeModelId(summary.model));
          return loading ? (
            <div key={t} aria-hidden className="h-40 animate-pulse rounded-lg border border-border bg-muted" />
          ) : (
            <TierCard
              key={t}
              tier={t}
              summary={summary}
              agents={h.tiers[t]}
              price={price ? { input: price.input_usd, output: price.output_usd } : undefined}
              newer={summary && tiers ? newerInFamily(summary.model, tiers.models) : null}
              write={write}
              onEdit={onEdit}
            />
          );
        })}
      </div>
      {h.pinned.length > 0 && <Lane title="Pinned (not affected by tier edits)" agents={h.pinned} />}
      {h.unmanaged.length > 0 && <Unmanaged agents={h.unmanaged} />}
    </section>
  );
}
