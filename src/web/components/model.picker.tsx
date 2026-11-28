import { useId, useMemo, useState } from "react";
import type { TierModelOption } from "../../server/tiers.types.ts";
import { Input } from "@/components/ui/input.tsx";
import { FAMILY_CLASSES, TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { fmtUsd } from "@/lib/format.ts";
import { fmtPrice, groupByFamily, isNewer, validateModelId } from "@/lib/tier.models.ts";

const FOCUS = "outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";
const MIN = "−";

interface Props {
  models: TierModelOption[];
  current: string;
  value: string;
  estimate: Record<string, number | null>;
  onChange: (id: string) => void;
}

const Chip = ({ children, tone }: { children: string; tone?: "info" | "neutral" }) => (
  <span className={cn("rounded-sm border px-1 text-xs", TONE_CLASSES[tone ?? "neutral"].badge)}>{children}</span>
);

function Delta({ id, current, estimate }: { id: string; current: string; estimate: Props["estimate"] }) {
  const cost = estimate[id], base = estimate[current];
  if (cost == null) return null;
  const diff = base == null ? null : cost - base;
  return (
    <span className="ml-auto text-xs whitespace-nowrap tabular-nums">
      {`≈ ${fmtUsd(cost)} / 30d`}
      {diff != null && id !== current && (
        <span className={cn("ml-1", TONE_CLASSES[diff <= 0 ? "success" : "warning"].text)}>
          {`(${diff <= 0 ? MIN : "+"}${fmtUsd(Math.abs(diff))})`}
        </span>
      )}
    </span>
  );
}

/** Searchable radiogroup of known models grouped by family, plus a validated custom-id row. */
export function ModelPicker({ models, current, value, estimate, onChange }: Props) {
  const uid = useId();
  const [q, setQ] = useState("");
  const all = useMemo(() => (models.some((m) => m.id === current) ? models : [{ id: current, input_usd: null, output_usd: null, in_pricing: false, requests_30d: 0 }, ...models]), [models, current]);
  const known = all.some((m) => m.id === value);
  const [custom, setCustom] = useState(!known);
  const groups = useMemo(() => groupByFamily(all.filter((m) => m.id.toLowerCase().includes(q.trim().toLowerCase()))), [all, q]);
  const err = custom ? validateModelId(value) : null;
  return (
    <div className="flex flex-col gap-2">
      <Input type="search" aria-label="Search models" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} />
      <div role="radiogroup" aria-label="Model" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.family} role="group" aria-label={g.label} className="flex flex-col gap-0.5">
            <h4 className={cn("px-1 pt-1 text-xs font-semibold", FAMILY_CLASSES[g.family].text)}>{g.label}</h4>
            {g.items.map((m) => (
              <label key={m.id} className="flex min-h-9 cursor-pointer flex-wrap items-center gap-2 rounded-md px-2 py-1 hover:bg-accent has-checked:bg-accent">
                <input type="radio" name={`${uid}-m`} checked={!custom && value === m.id} onChange={() => { setCustom(false); onChange(m.id); }} className={FOCUS} />
                <span className="font-mono text-sm">{m.id}</span>
                <span className="text-xs text-muted-foreground">{fmtPrice(m.input_usd, m.output_usd)}</span>
                {m.id === current && <Chip>current</Chip>}
                {isNewer(m.id, current) && <Chip tone="info">newer</Chip>}
                {m.requests_30d > 0 && <Chip>seen 30d</Chip>}
                <Delta id={m.id} current={current} estimate={estimate} />
              </label>
            ))}
          </div>
        ))}
        {!groups.length && <p className="px-2 text-sm text-muted-foreground">No models match "{q}".</p>}
        <div className="flex flex-col gap-1 rounded-md px-2 py-1 hover:bg-accent">
          <label className="flex min-h-9 cursor-pointer items-center gap-2">
            <input type="radio" name={`${uid}-m`} checked={custom} onChange={() => { setCustom(true); onChange(known ? "" : value); }} className={FOCUS} />
            <span className="text-sm">Custom model ID</span>
          </label>
          {custom && (
            <>
              <Input aria-label="Custom model ID" aria-invalid={!!err} aria-describedby={`${uid}-err`} className="font-mono" placeholder="claude-…" value={value} onChange={(e) => onChange(e.target.value)} />
              <p id={`${uid}-err`} role={err ? "alert" : undefined} className={cn("min-h-4 text-xs", TONE_CLASSES.danger.text)}>{value && err ? err : ""}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
