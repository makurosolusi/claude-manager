import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Save, TriangleAlert } from "lucide-react";
import type { Tier } from "../../config/config.store.ts";
import type { AgentDetail, AgentWriteResult } from "../../server/agents.types.ts";
import { ConfirmDialog } from "@/components/confirm.dialog.tsx";
import { Counter, CONTROL, Field, PROMPT_WARN_AT, PresetFixed, describe } from "@/components/agent.form.fields.tsx";
import { ModelFields } from "@/components/agent.form.model.tsx";
import { ToolFields } from "@/components/agent.form.tools.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { DESCRIPTION_MAX, PROMPT_MAX, emptyForm, fromDetail, isDirty, toInput, toPatch, validate, type FormErrors, type FormState } from "@/lib/agent.form.ts";
import { appliedText, holdNotice, toFailure, useFrozenEtag, type WriteFailure } from "@/lib/agent.write.ts";
import { sendJson } from "@/lib/api.write.ts";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { useDirtyGuard } from "@/lib/use.dirty.guard.ts";

const DEFAULT_PROMPT = "Leave empty to use the default prompt for this agent.";

interface Props {
  /** Agent to edit; absent = create. */
  agent?: AgentDetail;
  tiers: Record<Tier, string>;
  knownTools: string[];
  /** Latest `If-Match` value (detail etag for edit, list etag for create); the form freezes the one it mounted with and adopts a newer one only on Reload. */
  etag: string;
  /** Refetch list/detail so the next write uses the new etag. */
  onReload: () => void;
}

/** Create/edit form (spec 5.4): validates with `agent.form.ts`, writes through `sendJson`, guards unsaved edits. */
export function AgentForm({ agent, tiers, knownTools, etag: liveEtag, onReload }: Props) {
  const [etag, thaw] = useFrozenEtag(liveEtag);
  const id = useId();
  const isCreate = !agent;
  const kind = agent?.kind ?? "custom";
  const isPreset = kind === "preset";
  const [initial] = useState<FormState>(() => (agent ? fromDetail(agent) : emptyForm()));
  const [cur, setCur] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [serverField, setServerField] = useState<{ field: keyof FormErrors; text: string } | null>(null);
  const banner = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { pending, confirmDiscard, keepEditing, guard } = useDirtyGuard(!done && isDirty(initial, cur));
  const dirty = isDirty(initial, cur);
  const back = isCreate ? "#/agents" : `#/agents/${encodeURIComponent(agent.name)}`;

  const errors = validate(cur, { isCreate, kind });
  const invalid = Object.keys(errors).length > 0;
  const touch = (f: keyof FormErrors) => setTouched((t) => new Set(t).add(f));
  const set = (patch: Partial<FormState>) => { setCur((s) => ({ ...s, ...patch })); setServerField(null); };
  const shown = (f: keyof FormErrors) => (touched.has(f) ? errors[f] : undefined) ?? (serverField?.field === f ? serverField.text : undefined);

  useEffect(() => {
    if (!done) return;
    onReload();
    location.hash = isCreate ? `#/agents/${encodeURIComponent(cur.name)}` : back;
  }, [done]);
  // Move focus to the problem after a failed save: the banner, or the field the server named.
  useEffect(() => {
    if (!failure && !serverField) return;
    (banner.current ?? formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]"))?.focus();
  }, [failure, serverField]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving || invalid || (!isCreate && !dirty)) return;
    setSaving(true); setFailure(null); setServerField(null);
    try {
      const res = isCreate
        ? await sendJson<AgentWriteResult>("POST", "/api/agents", toInput(cur), etag)
        : await sendJson<AgentWriteResult>("PATCH", `/api/agents/${encodeURIComponent(agent.name)}`, toPatch(initial, cur, kind), etag);
      holdNotice({ tone: "success", text: appliedText("Saved", res.agent.name, res.applied), live: true }, `/agents/${encodeURIComponent(res.agent.name)}`);
      setDone(true);
    } catch (err) {
      const f = toFailure(err);
      if (f.field) setServerField({ field: f.field, text: f.text });
      else setFailure(f);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={save} noValidate className="flex flex-col gap-4">
      {failure && (
        <div ref={banner} tabIndex={-1} role="alert" className={cn("flex flex-wrap items-start gap-2 rounded-md border p-3 text-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring", TONE_CLASSES.danger.badge)}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 flex-1 break-words">{failure.text}</p>
          {failure.reload && <Button type="button" size="xs" variant="outline" onClick={() => { thaw(); onReload(); setFailure(null); }}>Reload</Button>}
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {agent && isPreset ? <PresetFixed agent={agent} /> : (
          <div className="flex min-w-0 flex-col gap-4">
            <Field id={`${id}-name`} label="Name" hint="lowercase, digits, dashes" error={shown("name")}>
              {isCreate
                ? <Input id={`${id}-name`} value={cur.name} maxLength={40} pattern="[a-z][a-z0-9\-]*" required spellCheck={false} autoComplete="off" className="font-mono"
                    aria-invalid={!!shown("name")} aria-describedby={describe(`${id}-name`, shown("name"))} onBlur={() => touch("name")} onChange={(e) => { touch("name"); set({ name: e.target.value }); }} />
                : <p className="font-mono text-sm">{agent.name}</p>}
            </Field>
            <Field id={`${id}-desc`} label="When to use" hint="Claude reads this to decide when to delegate." error={shown("description")} counter={<Counter n={cur.description.length} max={DESCRIPTION_MAX} />}>
              <textarea id={`${id}-desc`} rows={3} required value={cur.description} className={CONTROL} aria-invalid={!!shown("description")} aria-describedby={describe(`${id}-desc`, shown("description"))}
                onBlur={() => touch("description")} onChange={(e) => { touch("description"); set({ description: e.target.value }); }} />
            </Field>
            <Field id={`${id}-prompt`} label="System prompt" error={shown("prompt")} counter={<Counter n={cur.prompt.length} max={PROMPT_MAX} warn={PROMPT_WARN_AT} />}>
              <textarea id={`${id}-prompt`} rows={16} spellCheck={false} value={cur.prompt} placeholder={DEFAULT_PROMPT} className={cn(CONTROL, "resize-y font-mono text-[12.5px]")}
                aria-invalid={!!shown("prompt")} aria-describedby={shown("prompt") ? `${id}-prompt-err` : undefined} onChange={(e) => { touch("prompt"); set({ prompt: e.target.value }); }} />
            </Field>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          <ModelFields state={cur} set={set} tiers={tiers} isPreset={isPreset} error={shown("model")} onTouch={() => touch("model")} />
          {isPreset ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cur.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="accent-primary" />Enabled
            </label>
          ) : <ToolFields state={cur} set={set} knownTools={knownTools} error={shown("tools")} mcpError={shown("mcp")} onTouch={() => { touch("tools"); touch("mcp"); }} />}
        </div>
      </div>
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 border-t bg-background px-1 py-3">
        <Button type="button" variant="outline" onClick={() => guard(back)} className="max-sm:min-h-11">Cancel</Button>
        <Button type="submit" disabled={saving || invalid || (!isCreate && !dirty)} className="max-sm:min-h-11">
          {saving ? <LoaderCircle aria-hidden className="animate-spin" /> : <Save aria-hidden />}{saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <ConfirmDialog open={pending !== null} title="Discard unsaved changes?" body="Your edits haven't been saved and will be lost." confirmLabel="Discard" cancelLabel="Keep editing" destructive onConfirm={confirmDiscard} onCancel={keepEditing} />
    </form>
  );
}
