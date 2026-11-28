import { useRef } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn.ts";
import { ROLES_VIEWS, VIEW_LABEL, viewForKey, type RolesView } from "@/lib/roles.view.ts";

/** Segmented "By role / By model / By tier" control: an ARIA tablist with roving tabindex and arrow/Home/End keys. */
export function ViewSwitch({ value, onChange }: { value: RolesView; onChange: (v: RolesView) => void }) {
  const refs = useRef<Partial<Record<RolesView, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = viewForKey(value, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Group usage by" onKeyDown={onKeyDown} className="inline-flex max-w-full rounded-md border bg-muted/40 p-0.5">
      {ROLES_VIEWS.map((v) => {
        const on = v === value;
        return (
          <button
            key={v}
            ref={(el) => { refs.current[v] = el; }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(v)}
            className={cn(
              "h-10 flex-1 rounded-sm px-3 text-sm font-medium whitespace-nowrap outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring sm:h-7",
              on ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABEL[v]}
          </button>
        );
      })}
    </div>
  );
}

/** Text button that expands every group, or collapses them when all are open. */
export function ExpandAllButton({ allOpen, onClick }: { allOpen: boolean; onClick: () => void }) {
  const Icon = allOpen ? ChevronsDownUp : ChevronsUpDown;
  return (
    <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring sm:h-8">
      <Icon aria-hidden className="size-4" />
      {allOpen ? "Collapse all" : "Expand all"}
    </button>
  );
}
