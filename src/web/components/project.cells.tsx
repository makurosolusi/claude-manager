import { Folder, FolderOpen, GitBranch, Hourglass, House } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ProjectRow } from "../../server/dashboard.types.ts";
import type { ProjectKind } from "../../server/project.path.ts";
import { CopyButton } from "@/components/agent.copy.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import type { ToneKey } from "@/lib/color.tokens.ts";

/** Badge per non-project kind: label, icon, tone and the tooltip sentence (`repo` completes the worktree one). */
export const KIND_META: Record<ProjectKind, { label: string; icon: LucideIcon; tone: ToneKey; tip: (repo: string | null) => string }> = {
  project: { label: "Project", icon: FolderOpen, tone: "success", tip: () => "A working directory under your home folder" },
  worktree: { label: "Worktree", icon: GitBranch, tone: "info", tip: (repo) => (repo ? `of ${repo}` : "An agent worktree; its repo is unknown") },
  temp: { label: "Temp dir", icon: Hourglass, tone: "warning", tip: () => "Temporary directory; probably not a real project" },
  home: { label: "Home", icon: House, tone: "neutral", tip: () => "Sessions started in the home folder itself" },
  other: { label: "Other", icon: Folder, tone: "neutral", tip: () => "A directory outside your home folder" },
};

/** Kind badge with its tooltip. */
export function KindBadge({ kind, repo }: { kind: ProjectKind; repo: string | null }) {
  const m = KIND_META[kind];
  return (
    <Tooltip content={m.tip(repo)} focusable side="bottom">
      <ToneBadge tone={m.tone} icon={m.icon}>{m.label}</ToneBadge>
    </Tooltip>
  );
}

/** Full path in mono, cut from the left so the end (the folder that matters) stays visible. */
export function PathText({ path }: { path: string }) {
  return (
    <span className="block min-w-0 truncate text-left font-mono text-[11px] leading-4 text-muted-foreground [direction:rtl]" title={path}>
      <bdi>{path}</bdi>
    </span>
  );
}

/** Primary cell: name (plus a badge for non-project kinds, unless `hideKind`) over the full path. */
export function ProjectCell({ r, hideKind = false }: { r: ProjectRow; hideKind?: boolean }) {
  return (
    <span className="flex min-w-0 flex-col py-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
        <span className="max-w-full truncate" title={r.path_display}>{r.kind === "home" ? "Home directory" : r.name}</span>
        {r.kind !== "project" && !hideKind && <KindBadge kind={r.kind} repo={r.repo} />}
      </span>
      <PathText path={r.path_display} />
    </span>
  );
}

/** Copy-path button for a row. */
export const CopyPath = ({ r }: { r: ProjectRow }) => <CopyButton text={r.project} label={`Copy path of ${r.name}`} />;
