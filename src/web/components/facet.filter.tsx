import { useState } from "react";
import { ListFilter, Search, type LucideIcon } from "lucide-react";
import { Popover } from "@/components/ui/popover.tsx";
import { cn } from "@/lib/cn.ts";
import type { ToneKey } from "@/lib/color.tokens.ts";


const TONE_TEXT: Record<ToneKey, string> = {
  success: "text-tone-success-fg",
  warning: "text-tone-warning-fg",
  danger: "text-tone-danger-fg",
  info: "text-tone-info-fg",
  neutral: "text-tone-neutral-fg",
};
const SEARCH_MIN_OPTIONS = 8;
const MAX_LABELS = 2;

export interface FacetOption { value: string; label: string; icon?: LucideIcon; tone?: ToneKey; count: number }
export interface FacetDef { id: string; label: string; icon: LucideIcon; options: FacetOption[]; selected: string[]; onChange(next: string[]): void }

/** Dashed-outline facet button with a checkbox popover (optional search, counts, "Clear filter"). */
export function FacetFilter({ facet }: { facet: FacetDef }) {
  const { label, options, selected, onChange } = facet;
  const [term, setTerm] = useState("");
  const names = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const shown = options.filter((o) => o.label.toLowerCase().includes(term.trim().toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const Icon = facet.icon;

  return (
    <Popover
      label={`Filter by ${label}`}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-sm outline-hidden sm:h-8",
            "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-accent",
          )}
        >
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {selected.length ? (
            <>
              <span>{label}</span>
              <span aria-hidden className="h-4 w-px bg-border" />
              <span className="max-w-48 truncate font-medium">
                {names.slice(0, MAX_LABELS).join(", ")}
                {names.length > MAX_LABELS && ` +${names.length - MAX_LABELS}`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">+ {label}</span>
          )}
        </button>
      )}
    >
      {options.length > SEARCH_MIN_OPTIONS && (
        <div className="flex items-center gap-2 border-b px-3">
          <Search aria-hidden className="size-4 text-muted-foreground" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label={`Search ${label}`}
            placeholder={label}
            className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          />
        </div>
      )}
      <ul className="max-h-64 overflow-auto p-1">
        {shown.map((o) => {
          const on = selected.includes(o.value);
          const OptIcon = o.icon;
          return (
            <li key={o.value}>
              <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent sm:min-h-8", o.count === 0 && !on && "opacity-50")}>
                <input type="checkbox" checked={on} onChange={() => toggle(o.value)} className="size-4 accent-primary" />
                {OptIcon && <OptIcon aria-hidden className={cn("size-4", TONE_TEXT[o.tone ?? "neutral"])} />}
                <span className="flex-1 truncate">{o.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span>
              </label>
            </li>
          );
        })}
        {!shown.length && <li className="px-2 py-3 text-sm text-muted-foreground">No matches.</li>}
      </ul>
      <div className="flex items-center justify-between border-t p-1">
        <ListFilter aria-hidden className="ml-2 size-4 text-muted-foreground" />
        <button
          type="button"
          disabled={!selected.length}
          onClick={() => onChange([])}
          className="min-h-11 rounded-sm px-3 text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50 sm:min-h-8"
        >
          Clear filter
        </button>
      </div>
    </Popover>
  );
}
