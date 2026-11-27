import { X } from "lucide-react";
import { fmtProject } from "@/lib/format.ts";

/** Removable `project:` filter chip; no vertical padding so it never grows the text line it sits on. */
export function ProjectChip({ cwd, onRemove }: { cwd: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-sm border px-1.5 text-xs">
      <span className="text-fg-subtle">project:</span>
      <span className="truncate font-mono text-foreground" title={cwd}>{fmtProject(cwd)}</span>
      <button type="button" aria-label="Remove project filter" onClick={onRemove} className="shrink-0 rounded-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}
