import { useId } from "react";
import type { Tier } from "../../config/config.store.ts";
import { Input } from "@/components/ui/input.tsx";
import { ModelChain } from "@/components/model.chain.tsx";
import { FOCUS, Group } from "@/components/agent.form.fields.tsx";
import { previewChain, type FormState, type ModelMode } from "@/lib/agent.form.ts";
import { cn } from "@/lib/cn.ts";
import { TIER_ICON } from "@/lib/icon.map.ts";

const TIERS: Tier[] = ["think", "work", "basic"];
const ALIASES = ["opus", "sonnet", "haiku", "fable"];
const CARD = "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-ring has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-ring";

interface Props {
  state: FormState;
  set: (patch: Partial<FormState>) => void;
  tiers: Record<Tier, string>;
  isPreset: boolean;
  error?: string;
  onTouch: () => void;
}

/** Model fieldset: tier cards, pin input or (presets) default, plus a live chain preview. */
export function ModelFields({ state, set, tiers, isPreset, error, onTouch }: Props) {
  const id = useId();
  const modes: [ModelMode, string][] = [["tier", "Tier"], ["pin", "Pin a model"], ...(isPreset ? [["default", "Default"] as [ModelMode, string]] : [])];
  const setMode = (m: ModelMode) => { onTouch(); set({ modelMode: m, modelValue: m === "tier" ? "work" : "" }); };
  return (
    <Group id={id} legend="Model" error={error} hint="Which model this agent runs on.">
      <div role="radiogroup" aria-label="Model mode" className="flex flex-wrap gap-x-4 gap-y-2">
        {modes.map(([m, label]) => (
          <label key={m} className="inline-flex min-h-6 cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" name={`${id}-mode`} checked={state.modelMode === m} onChange={() => setMode(m)} className={cn("accent-primary", FOCUS)} />{label}
          </label>
        ))}
      </div>
      {state.modelMode === "tier" && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {TIERS.map((t) => { const Icon = TIER_ICON[t]; return (
            <label key={t} className={CARD}>
              <input type="radio" name={`${id}-tier`} value={t} checked={state.modelValue === t} onChange={() => { onTouch(); set({ modelValue: t }); }} className="sr-only" />
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0"><span className="block font-medium">{t}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{tiers[t]}</span></span>
            </label>
          ); })}
        </div>
      )}
      {state.modelMode === "pin" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-pin`} className="text-xs font-medium">Model alias or ID</label>
          <Input id={`${id}-pin`} list={`${id}-models`} value={state.modelValue} placeholder="fable" spellCheck={false} autoComplete="off"
            aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} onBlur={onTouch} onChange={(e) => set({ modelValue: e.target.value.trim() })} className="font-mono" />
          <datalist id={`${id}-models`}>{[...new Set([...ALIASES, ...Object.values(tiers)])].map((m) => <option key={m} value={m} />)}</datalist>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>Runs on</span>
        {state.modelMode === "default" ? <span className="font-mono">preset default</span> : <ModelChain row={previewChain(state, tiers)} tiers={tiers} />}
      </div>
    </Group>
  );
}
