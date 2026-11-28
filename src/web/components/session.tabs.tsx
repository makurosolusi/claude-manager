import { useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn.ts";
import { fmtInt } from "@/lib/format.ts";
import { SESSION_TABS, tabForKey, type SessionTab } from "@/lib/session.tabs.ts";

export interface SessionTabDef { id: SessionTab; label: string; icon: LucideIcon; count?: number }

const tabId = (t: SessionTab) => `session-tab-${t}`;
const panelId = (t: SessionTab) => `session-panel-${t}`;

/** Card with an ARIA tablist (roving tabindex, arrows/Home/End) over one panel; only the active child is rendered, so hidden tables never mount or poll. */
export function SessionTabs({ tabs, active, onChange, children }: { tabs: SessionTabDef[]; active: SessionTab; onChange: (t: SessionTab) => void; children: ReactNode }) {
  const refs = useRef<Partial<Record<SessionTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = tabForKey(active, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4 [--table-bg:var(--card)]">
      <div role="tablist" aria-label="Session details" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b">
        {SESSION_TABS.map((id) => {
          const t = tabs.find((x) => x.id === id)!;
          const on = id === active;
          return (
            <button
              key={id}
              ref={(el) => { refs.current[id] = el; }}
              id={tabId(id)}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={panelId(id)}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(id)}
              className={cn(
                "-mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring sm:h-9",
                on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon aria-hidden className="size-4" />
              {t.label}
              {t.count !== undefined && <span className="rounded-sm bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{fmtInt(t.count)}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId(active)} aria-labelledby={tabId(active)} className="min-w-0">{children}</div>
    </section>
  );
}
