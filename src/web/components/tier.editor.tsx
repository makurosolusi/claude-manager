import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AgentRow } from "../../server/agents.types.ts";
import type { TierModelOption, TierSummary } from "../../server/tiers.types.ts";
import { ModelPicker } from "@/components/model.picker.tsx";
import { Button } from "@/components/ui/button.tsx";
import { affectedBy } from "@/lib/agents.hierarchy.ts";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { FAMILY_LABEL, modelFamily } from "@/lib/model.tier.ts";
import { normalizeModelId, validateModelId } from "@/lib/tier.models.ts";

const FOCUS = "outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";

interface Props {
  open: boolean;
  tier: TierSummary;
  models: TierModelOption[];
  items: AgentRow[];
  preselect?: string;
  /** Persist the model; the parent reports failures through `error` (a rejection only ends the busy state). */
  onSave: (model: string) => Promise<void>;
  onClose: () => void;
  error?: string;
  /** Passed by the parent on a stale-etag 412 to offer a Reload button. */
  onReload?: () => void;
}

const Warn = ({ children }: { children: string }) => (
  <p className={cn("flex items-start gap-1.5 rounded-md border p-2 text-xs", TONE_CLASSES.warning.badge)}>
    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />{children}
  </p>
);

/** Modal for changing the model behind one tier, with affected agents, warnings and a re-priced 30-day estimate. */
export function TierEditor({ open, tier, models, items, preselect, onSave, onClose, error, onReload }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const current = normalizeModelId(tier.model);
  const [sel, setSel] = useState(normalizeModelId(preselect ?? tier.model));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setSel(normalizeModelId(preselect ?? tier.model)); setBusy(false); d.showModal(); }
    else if (!open && d.open) d.close();
  }, [open, preselect, tier.model]);

  const valid = !validateModelId(sel);
  const changed = valid && normalizeModelId(sel) !== current;
  const family = modelFamily(sel);
  const priced = models.find((m) => m.id === normalizeModelId(sel));
  const noPrice = valid && (!priced || priced.input_usd == null || priced.output_usd == null);
  const save = async () => {
    setBusy(true);
    try { await onSave(sel.trim()); } catch { /* the parent surfaces the failure via `error` */ } finally { setBusy(false); }
  };
  const label = tier.tier;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      className={cn("m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg backdrop:bg-black/50 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:rounded-none", FOCUS)}
    >
      <h2 id={`${id}-t`} className="text-base font-semibold">Change the {label} model</h2>
      {error && (
        <div role="alert" className={cn("mt-3 flex items-center gap-2 rounded-md border p-2 text-sm", TONE_CLASSES.danger.badge)}>
          <span className="min-w-0 flex-1">{error}</span>
          {onReload && <Button type="button" size="sm" variant="outline" onClick={onReload}>Reload</Button>}
        </div>
      )}
      <div className="mt-3">
        <ModelPicker models={models} current={current} value={sel} estimate={tier.estimate_30d} onChange={setSel} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Same tokens re-priced; a different model may use more or fewer tokens.</p>
      <section aria-label="Affects" className="mt-3">
        <h3 className="text-sm font-medium">Affects</h3>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
          {affectedBy(tier.tier, items).map((a) => <li key={`${a.kind}:${a.label}`} className={a.kind === "text" ? "" : "font-mono"}>{a.label}</li>)}
        </ul>
      </section>
      <div className="mt-3 flex flex-col gap-2">
        {valid && family !== tier.alias && family !== "other" && (
          <Warn>{`The ${tier.alias} alias will point to a ${FAMILY_LABEL[family]} model; /model will list it in the ${tier.alias[0]!.toUpperCase()}${tier.alias.slice(1)} row.`}</Warn>
        )}
        {noPrice && <Warn>Costs for this model will show as unpriced.</Warn>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {`Written to settings.json (${tier.env}). Applies to new Claude Code sessions; running sessions reload settings and may switch on their next request — restart them to be sure.`}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose} className={FOCUS}>Cancel</Button>
        <Button type="button" disabled={!changed || busy} onClick={save} className={FOCUS}>{busy ? "Saving…" : "Change model"}</Button>
      </div>
    </dialog>
  );
}
