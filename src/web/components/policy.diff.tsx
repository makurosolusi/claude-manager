import { Minus, Plus, Equal } from "lucide-react";
import { Panel } from "@/components/panel.tsx";
import { Button } from "@/components/ui/button.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import type { PolicyPreview, SettingsChange } from "../../server/policy.types.ts";

const HOOKS = "hooks.PreToolUse";
const OPS = {
  add: { icon: Plus, tone: TONE_CLASSES.success.text, label: "add" },
  remove: { icon: Minus, tone: TONE_CLASSES.danger.text, label: "remove" },
  keep: { icon: Equal, tone: "text-muted-foreground", label: "already yours" },
  set: { icon: Equal, tone: TONE_CLASSES.info.text, label: "set" },
} as const;

const show = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** The registered hook as one string, from the preview's hook change (null when there is none). */
export function hookCommandOf(changes: SettingsChange[]): string | null {
  const g = changes.find((c) => c.list === HOOKS && c.op !== "remove")?.value as { hooks?: { command?: string; args?: string[] }[] } | undefined;
  const h = g?.hooks?.[0];
  return h?.command ? [h.command, ...(h.args ?? [])].join(" ") : null;
}

function Line({ c }: { c: SettingsChange }) {
  const o = OPS[c.op];
  return (
    <li className="flex items-start gap-2 py-0.5 font-mono text-xs">
      <o.icon aria-label={o.label} className={`mt-0.5 size-3.5 shrink-0 ${o.tone}`} />
      <span className="min-w-0 break-all">{c.op === "set" ? `${c.list} = ${show(c.value)}` : show(c.value)}</span>
      {c.op === "keep" && <span className="shrink-0 font-sans text-[11px] text-muted-foreground">already yours</span>}
    </li>
  );
}

interface Props { preview: PolicyPreview; title: string; busy: boolean; onApply: () => void; onCancel: () => void }

/** Dry-run result: settings changes grouped by list, the hook command and what else is written. */
export function PolicyDiff({ preview, title, busy, onApply, onCancel }: Props) {
  const lists = [...new Set(preview.changes.filter((c) => c.list !== HOOKS).map((c) => c.list ?? "settings"))];
  const hook = hookCommandOf(preview.changes);
  return (
    <Panel title="Review changes" action={<span className="font-mono text-xs text-muted-foreground break-all">{preview.settings_path}</span>}>
      {!preview.changes.length && <p className="text-sm text-muted-foreground">No settings change, snapshot only.</p>}
      {lists.map((l) => (
        <div key={l}>
          <h3 className="text-xs font-medium text-foreground">{l}</h3>
          <ul>{preview.changes.filter((c) => (c.list ?? "settings") === l && c.list !== HOOKS).map((c, i) => <Line key={i} c={c} />)}</ul>
        </div>
      ))}
      {hook && (
        <div>
          <h3 className="text-xs font-medium text-foreground">Hook ({HOOKS})</h3>
          <p className="mt-0.5 rounded-sm border bg-muted/40 px-2 py-1 font-mono text-xs break-all">{hook}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Also writes the compiled snapshot (<code className="font-mono">policy.compiled.json</code> in the claude-manager folder) that the hook reads. Your own rules are never removed.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11 sm:min-h-0" disabled={busy} onClick={onApply}>{title}</Button>
        <Button className="min-h-11 sm:min-h-0" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </Panel>
  );
}
