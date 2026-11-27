import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn.ts";
import { FunnelX, Search } from "lucide-react";
import { ColumnMenu, type ColumnMenuProps } from "@/components/column.menu.tsx";
import { FacetFilter, type FacetDef } from "@/components/facet.filter.tsx";

const SEARCH_DEBOUNCE_MS = 250;
const FIELD = "h-11 rounded-md border border-input bg-transparent text-sm outline-hidden focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8 dark:bg-input/30";

export interface TableToolbarProps {
  search?: { value: string; onChange(v: string): void; placeholder: string; label: string };
  facets?: FacetDef[];
  group?: { value: string; options: { value: string; label: string }[]; onChange(v: string): void };
  view?: ColumnMenuProps;
  onReset?: () => void;
  summary?: ReactNode;
}

export interface SearchFieldProps { value: string; onChange(v: string): void; placeholder: string; label: string; shortcut?: boolean; className?: string }

/** Debounced (250ms) search input with a magnifier; `shortcut` (default) also makes "/" focus it, so only one field per page should keep it. */
export function SearchField({ value, onChange, placeholder, label, shortcut = true, className }: SearchFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || el?.closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      ref.current?.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [shortcut]);
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-keyshortcuts={shortcut ? "/" : undefined}
        className={`${FIELD} w-full pr-2 pl-8`}
      />
    </div>
  );
}

/** Search, facet filters, group select, View menu and a Reset shown only when filters are active. */
export function TableToolbar({ search, facets, group, view, onReset, summary }: TableToolbarProps) {
  const active = (search?.value ?? "") !== "" || !!facets?.some((f) => f.selected.length) || (!!group && group.options[0]?.value !== group.value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {search && <SearchField {...search} />}
        {facets && facets.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {facets.map((f) => <FacetFilter key={f.id} facet={f} />)}
          </div>
        )}
        {onReset && active && (
          <button type="button" onClick={onReset} className="inline-flex h-11 items-center gap-1.5 self-start rounded-md px-2.5 text-sm hover:bg-accent sm:h-8">
            <FunnelX aria-hidden className="size-4" />
            Reset
          </button>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          {group && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Group
              <select value={group.value} onChange={(e) => group.onChange(e.target.value)} className={`${FIELD} px-2 text-foreground`}>
                {group.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          {view && <ColumnMenu {...view} />}
        </div>
      </div>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
    </div>
  );
}
