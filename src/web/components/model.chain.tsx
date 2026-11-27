import { Pin } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { FAMILY_CLASSES } from "@/lib/color.tokens.ts";
import { chainText, type ChainInput } from "@/lib/agents.table.ts";
import { cn } from "@/lib/cn.ts";
import { TIER_ICON } from "@/lib/icon.map.ts";
import { modelFamily, tierFamily, type Tiers } from "@/lib/model.tier.ts";

interface ModelChainProps {
  row: ChainInput;
  /** Alias only (plus the pin icon); for narrow screens. */
  compact?: boolean;
  /** Tier → model map, so the tier wears the colour of the model it routes to. */
  tiers?: Partial<Tiers>;
  className?: string;
}

const Arrow = () => <span aria-hidden className="text-muted-foreground">→</span>;
const family = (id: string | null) => FAMILY_CLASSES[id ? modelFamily(id) : "other"].text;

/** Which model an agent runs: `tier → alias → model-id` (or `pinned → alias`), mono, coloured by model family. */
export function ModelChain({ row, compact, tiers, className }: ModelChainProps) {
  const label = chainText(row);
  const { tier, pin, alias, model_id } = row;
  const main = alias ?? model_id ?? pin;
  const parts: ReactNode[] = [];

  if (compact) {
    if (pin) parts.push(<Pin key="pin" aria-hidden className="size-3 shrink-0" />);
    parts.push(<span key="a" className={family(main)}>{main ?? "inherit"}</span>);
  } else {
    if (pin) {
      parts.push(
        <span key="pin" className="inline-flex items-center gap-1 text-foreground">
          <Pin aria-hidden className="size-3 shrink-0" />pinned
        </span>,
      );
    } else if (tier) {
      const Icon = TIER_ICON[tier];
      parts.push(
        <span key="tier" className={cn("inline-flex items-center gap-1", FAMILY_CLASSES[tierFamily(tier, tiers)].text)}>
          <Icon aria-hidden className="size-3 shrink-0" />{tier}
        </span>,
      );
    }
    if (alias) parts.push(<span key="a" className={family(alias)}>{alias}</span>);
    if (model_id && model_id !== alias) parts.push(<span key="m" className={cn("truncate", family(model_id))}>{model_id}</span>);
    if (!parts.length) parts.push(<span key="i" className="text-muted-foreground">inherit</span>);
  }

  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 font-mono text-xs whitespace-nowrap", className)}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && !compact && <Arrow />}
          {p}
        </Fragment>
      ))}
    </span>
  );
}
