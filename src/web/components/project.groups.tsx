import { FolderTree, Hourglass, House, Folder } from "lucide-react";
import type { ProjectRow } from "../../server/dashboard.types.ts";
import type { ClientGrouping } from "@/components/client.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { KindBadge } from "@/components/project.cells.tsx";
import { CacheText } from "@/components/projects.columns.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { fmtInt, fmtTokens } from "@/lib/format.ts";
import { bucketOf, projectTotals, type ProjectGroup } from "@/lib/projects.table.ts";

/** Group dropdown choices, in resolved values (the page maps them to and from URL values). */
export const PROJECT_GROUP_OPTIONS: { value: ProjectGroup; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "kind", label: "Kind" },
  { value: "none", label: "No grouping" },
];

/** Grouping rule of the Projects table for the resolved `mode`: by folder (worktrees beside their repo) or by kind. */
export function projectGrouping(mode: ProjectGroup): ClientGrouping<ProjectRow> {
  return {
    options: PROJECT_GROUP_OPTIONS,
    of: (r) => {
      if (mode === "kind") return { key: r.kind, label: <KindBadge kind={r.kind} repo={null} /> };
      const b = bucketOf(r);
      const Icon = b.key === "temp" ? Hourglass : b.key === "home" ? House : b.key === "other" ? Folder : FolderTree;
      // Named buckets show their label; the tooltip of the temp bucket carries the real tmp path.
      const named = b.rank > 0;
      return {
        key: b.key,
        label: (
          <span className={`flex min-w-0 items-center gap-2 text-xs ${named ? "font-medium" : "font-mono"}`} title={b.key === "temp" ? r.parent : b.label}>
            <Icon aria-hidden className={`size-4 shrink-0 ${b.key === "temp" ? TONE_CLASSES.warning.text : "text-muted-foreground"}`} />
            {named ? <span className="truncate">{b.label}</span> : <span className="truncate [direction:rtl]"><bdi>{b.label}</bdi></span>}
          </span>
        ),
      };
    },
    totals: (rows) => {
      const t = projectTotals(rows);
      return { sessions: fmtInt(t.sessions), requests: fmtInt(t.requests), tokens: fmtTokens(t.tokens), cache: <CacheText ratio={t.cache} />, cost: <CostCell usd={t.cost} />, last: <RelativeTime iso={t.last} /> };
    },
  };
}
