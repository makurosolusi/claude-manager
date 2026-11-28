import { useId, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { FOCUS, Group, ErrorText, Hint, describe } from "@/components/agent.form.fields.tsx";
import { MCP_RE, parseMcpList, type FormState, type ToolsMode } from "@/lib/agent.form.ts";
import { cn } from "@/lib/cn.ts";
import { toolIcon } from "@/lib/icon.map.ts";

interface Props {
  state: FormState;
  set: (patch: Partial<FormState>) => void;
  knownTools: string[];
  error?: string;
  mcpError?: string;
  onTouch: () => void;
}

/** Tools fieldset: all-but-Agent or an explicit checkbox grid plus MCP chips. */
export function ToolFields({ state, set, knownTools, error, mcpError, onTouch }: Props) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const all = [...knownTools, ...state.tools.filter((t) => !knownTools.includes(t))];
  const modes: [ToolsMode, string][] = [["all", "All tools except Agent"], ["only", "Only these"]];
  const toggle = (t: string) => { onTouch(); set({ tools: state.tools.includes(t) ? state.tools.filter((x) => x !== t) : [...state.tools, t] }); };
  const commit = () => {
    const add = parseMcpList(draft);
    if (add.length) set({ mcp: [...new Set([...state.mcp, ...add])] });
    setDraft("");
    onTouch();
  };
  return (
    <Group id={id} legend="Tools" error={error}>
      <div role="radiogroup" aria-label="Tools mode" className="flex flex-wrap gap-x-4 gap-y-2">
        {modes.map(([m, label]) => (
          <label key={m} className="inline-flex min-h-6 cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" name={`${id}-mode`} checked={state.toolsMode === m} onChange={() => { onTouch(); set({ toolsMode: m }); }} className={cn("accent-primary", FOCUS)} />{label}
          </label>
        ))}
      </div>
      {state.toolsMode === "only" && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {all.map((t) => { const Icon = toolIcon(t); return (
              <label key={t} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-sm has-checked:border-ring has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-ring">
                <input type="checkbox" checked={state.tools.includes(t)} onChange={() => toggle(t)} className="sr-only" />
                <Icon aria-hidden className="size-3.5 shrink-0" /><span className="truncate font-mono text-xs">{t}</span>
              </label>
            ); })}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-mcp`} className="text-xs font-medium">MCP tools</label>
            <Input id={`${id}-mcp`} value={draft} placeholder="mcp__github__create_issue" spellCheck={false} autoComplete="off" className="font-mono"
              aria-invalid={!!mcpError} aria-describedby={describe(`${id}-mcp`, mcpError)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }} />
            <Hint id={`${id}-mcp`}>Comma or newline separated: mcp__server or mcp__server__tool. Press Enter to add.</Hint>
            <ErrorText id={`${id}-mcp`} error={mcpError} />
            {state.mcp.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {state.mcp.map((m) => (
                  <li key={m} className={cn("inline-flex items-center gap-1 rounded-sm border py-0.5 pr-0.5 pl-1.5 font-mono text-xs", !MCP_RE.test(m) && "border-destructive")}>
                    {m}
                    <button type="button" aria-label={`Remove ${m}`} onClick={() => set({ mcp: state.mcp.filter((x) => x !== m) })} className={cn("rounded-sm p-0.5 hover:bg-accent", FOCUS)}><X aria-hidden className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Group>
  );
}
