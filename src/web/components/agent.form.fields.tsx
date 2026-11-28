import type { ReactNode } from "react";
import type { AgentDetail } from "../../server/agents.types.ts";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { PROMPT_MAX, PROMPT_WARN_RATIO } from "@/lib/agent.form.ts";
import { cn } from "@/lib/cn.ts";
import { toolIcon } from "@/lib/icon.map.ts";

export const FOCUS = "outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";
/** Text control look shared by textarea (Input covers `<input>`). */
export const CONTROL = "w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-hidden placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50 dark:bg-input/30";
/** `aria-describedby` value for a field built with `Hint`/`ErrorText`. */
export const describe = (id: string, error?: string): string => (error ? `${id}-hint ${id}-err` : `${id}-hint`);

export const Hint = ({ id, children }: { id: string; children: ReactNode }) => <p id={`${id}-hint`} className="text-xs text-muted-foreground">{children}</p>;
export const ErrorText = ({ id, error }: { id: string; error?: string }) =>
  error ? <p id={`${id}-err`} className={cn("text-xs", TONE_CLASSES.danger.text)}>{error}</p> : null;

/** `n / max` counter; warning tone from `warn`, danger above max. */
export function Counter({ n, max, warn = max }: { n: number; max: number; warn?: number }) {
  const tone = n > max ? TONE_CLASSES.danger.text : n >= warn ? TONE_CLASSES.warning.text : "text-muted-foreground";
  return <span className={cn("font-mono text-xs tabular-nums", tone)}>{n.toLocaleString("en-US")} / {max.toLocaleString("en-US")}</span>;
}
export const PROMPT_WARN_AT = PROMPT_MAX * PROMPT_WARN_RATIO;

/** Label + control + hint/error wrapper; the control gets `id` and `describe(id, error)` from the caller. */
export function Field({ id, label, hint, error, counter, children }: { id: string; label: string; hint?: ReactNode; error?: string; counter?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {counter}
      </div>
      {children}
      {hint && <Hint id={id}>{hint}</Hint>}
      <ErrorText id={id} error={error} />
    </div>
  );
}

/** Fieldset with a legend, optional hint and an error line (ids derive from `id`). */
export function Group({ id, legend, hint, error, children }: { id: string; legend: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <fieldset aria-describedby={describe(id, error)} className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      {hint && <Hint id={id}>{hint}</Hint>}
      {children}
      <ErrorText id={id} error={error} />
    </fieldset>
  );
}

/** Preset agents: every field except Model and Enabled is fixed, so show it as plain read-only content. */
export function PresetFixed({ agent }: { agent: AgentDetail }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4 text-sm">
      <p className="text-xs text-muted-foreground">Preset agents only allow changing the model and enabling or disabling them.</p>
      <div><div className="text-xs font-medium text-muted-foreground">When to use</div><p>{agent.description}</p></div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Tools</div>
        {agent.tools ? (
          <ul className="flex flex-wrap gap-1.5">
            {agent.tools.map((t) => { const Icon = toolIcon(t); return <li key={t} className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-xs"><Icon aria-hidden className="size-3" />{t}</li>; })}
          </ul>
        ) : "All tools except Agent"}
      </div>
      <div>
        <div id="preset-prompt-label" className="mb-1 text-xs font-medium text-muted-foreground">System prompt (read-only)</div>
        <pre tabIndex={0} aria-labelledby="preset-prompt-label" className={cn("max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[12.5px] whitespace-pre-wrap break-words", FOCUS)}>{agent.prompt || "No prompt available."}</pre>
      </div>
    </div>
  );
}
