import { Panel } from "@/components/panel.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/cn.ts";
import { PRESET_LABEL, PRESET_NAMES, RECOMMENDED_PRESET } from "../../policy/policy.presets.ts";
import type { PolicyConfig, PolicyInput, PresetName } from "../../server/policy.types.ts";

export interface SetupForm { preset: PresetName; scope: PolicyInput["scope"]; acceptEdits: boolean; ack: boolean }
export const DEFAULT_SETUP: SetupForm = { preset: RECOMMENDED_PRESET, scope: "user", acceptEdits: false, ack: false };

const PRESET_TEXT: Record<PresetName, string> = {
  strict: "Workers read freely and ask before they edit, run tests or use the shell. Analysts never edit.",
  balanced: "Workers read, edit and run tests without asking; shell, web and commits still ask. Edit and test can run code.",
  autonomous: "Workers also commit, use the shell and the web without asking. Balanced is safer: shell still asks there.",
};
const SCOPE_TEXT = {
  user: ["User", "All projects, written to ~/.claude/settings.json."],
  project: ["This project", "Only this git root, written to .claude/settings.local.json (personal, never committed)."],
} as const;
const FOCUS = "has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-ring";

function Choice({ name, checked, onChange, title, text, badge }: { name: string; checked: boolean; onChange: () => void; title: string; text: string; badge?: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer gap-2.5 rounded-md border p-3 text-sm", FOCUS, checked ? "border-foreground bg-surface-hover" : "hover:bg-surface-hover")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 accent-[var(--foreground)] outline-hidden" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}{badge && <span className="ml-2 text-xs font-normal text-muted-foreground">{badge}</span>}</span>
        <span className="text-xs text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

interface Props { form: SetupForm; onChange: (f: SetupForm) => void; onPreview: () => void; busy: boolean }

/** Preset, scope and Accept-edits choice for a first setup or a preset change; Preview leads to the diff. */
export function PolicySetup({ form, onChange, onPreview, busy }: Props) {
  const set = (p: Partial<SetupForm>) => onChange({ ...form, ...p });
  return (
    <Panel title="Choose a preset">
      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Preset">
        {PRESET_NAMES.map((p) => (
          <Choice key={p} name="preset" checked={form.preset === p} onChange={() => set({ preset: p, ack: false })}
            title={PRESET_LABEL[p]} badge={p === RECOMMENDED_PRESET ? "recommended" : undefined} text={PRESET_TEXT[p]} />
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label="Scope">
        {(Object.keys(SCOPE_TEXT) as (keyof typeof SCOPE_TEXT)[]).map((s) => (
          <Choice key={s} name="scope" checked={form.scope === s} onChange={() => set({ scope: s })} title={SCOPE_TEXT[s][0]} text={SCOPE_TEXT[s][1]} />
        ))}
      </div>
      <label className="flex min-h-11 items-start gap-2.5 text-sm sm:min-h-0">
        <input type="checkbox" checked={form.acceptEdits} onChange={(e) => set({ acceptEdits: e.target.checked })} className="mt-1 accent-[var(--foreground)]" />
        <span>Also start sessions in Accept edits
          <span className="block text-xs text-muted-foreground">Writes permissions.defaultMode to the same settings file, so it changes every session at that scope.</span>
        </span>
      </label>
      {form.preset === "autonomous" && (
        <label className="flex min-h-11 items-start gap-2.5 text-sm sm:min-h-0">
          <input type="checkbox" checked={form.ack} onChange={(e) => set({ ack: e.target.checked })} className="mt-1 accent-[var(--foreground)]" />
          <span>I understand workers can run any shell command without asking. Push, publish and deploy are detected from the command text, so unusual forms may not be caught.</span>
        </label>
      )}
      <div><Button className="min-h-11 w-full sm:min-h-0 sm:w-auto" disabled={busy || (form.preset === "autonomous" && !form.ack)} onClick={onPreview}>Preview changes</Button></div>
    </Panel>
  );
}

/** "Preset: Balanced · Scope: user · Accept edits: off" for a stored policy. */
export const summaryLine = (c: PolicyConfig): string =>
  `Preset: ${PRESET_LABEL[c.preset]} · Scope: ${c.scope} · Accept edits: ${c.defaultMode === "acceptEdits" ? "on" : "off"}`;

/** Compact stand-in for the setup card once a policy exists; "Change preset" (when allowed) opens the full card. */
export function PolicySummary({ config, onChange }: { config: PolicyConfig; onChange?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-muted-foreground">{summaryLine(config)}</span>
      {onChange && <Button variant="outline" size="sm" className="max-sm:min-h-11 max-sm:w-full" onClick={onChange}>Change preset</Button>}
    </div>
  );
}

/** Setup form seeded from the stored policy, so changing a preset starts from what is applied. */
export const formFromConfig = (c: PolicyConfig): SetupForm => ({ preset: c.preset, scope: c.scope, acceptEdits: c.defaultMode === "acceptEdits", ack: false });
