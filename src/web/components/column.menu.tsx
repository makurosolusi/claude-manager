import { Columns3 } from "lucide-react";
import { Popover } from "@/components/ui/popover.tsx";
import type { Density } from "@/lib/table.prefs.ts";
import { cn } from "@/lib/cn.ts";

const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact 36px" },
  { value: "comfortable", label: "Comfortable 44px" },
];

export interface ColumnMenuProps {
  columns: { id: string; label: string; visible: boolean }[];
  onToggle(id: string): void;
  density: Density;
  onDensity(d: Density): void;
}

/** "View" popover: column visibility checkboxes plus a row-density radio group. */
export function ColumnMenu({ columns, onToggle, density, onDensity }: ColumnMenuProps) {
  const row = "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-accent sm:min-h-8";
  return (
    <Popover
      label="View options"
      align="end"
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm outline-hidden sm:h-8",
            "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-accent",
          )}
        >
          <Columns3 aria-hidden className="size-4" />
          View
        </button>
      )}
    >
      <fieldset className="p-1">
        <legend className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Columns</legend>
        {columns.map((c) => (
          <label key={c.id} className={row}>
            <input type="checkbox" checked={c.visible} onChange={() => onToggle(c.id)} className="size-4 accent-primary" />
            {c.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="border-t p-1">
        <legend className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Density</legend>
        {DENSITIES.map((d) => (
          <label key={d.value} className={row}>
            <input type="radio" name="cm-density" checked={density === d.value} onChange={() => onDensity(d.value)} className="size-4 accent-primary" />
            {d.label}
          </label>
        ))}
      </fieldset>
    </Popover>
  );
}
