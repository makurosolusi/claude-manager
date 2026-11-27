import { SessionStatusBadge } from "@/components/status.badge.tsx";
import { RelativeTime } from "@/components/relative.time.tsx";
import { fmtProject } from "@/lib/format.ts";
import { sessionStatus } from "@/lib/status.level.ts";

/** Visible length of the id shown for untitled sessions. */
const SHORT_ID_LEN = 8;

interface SessionCellProps {
  id: string;
  title: string | null;
  projectCwd: string | null;
  /** Link target for the title. Omit inside a DataTable with `rowHref` when this is the first column (the table already wraps it). */
  href?: string;
  /** With `now`, below sm a second line shows `● status · project · age`. */
  lastTs?: string | null;
  now?: number;
}

/** Session label: title (or "Untitled session" + short id) and dimmed `acme/web`; two lines below sm when `lastTs`/`now` are given. */
export function SessionCell({ id, title, projectCwd, href, lastTs, now }: SessionCellProps) {
  const name = title?.trim();
  const label = name ? (
    <span className="text-foreground">{name}</span>
  ) : (
    <>
      <span className="text-muted-foreground italic">Untitled session</span>{" "}
      <span className="font-mono text-xs text-fg-subtle">{id.slice(0, SHORT_ID_LEN)}</span>
    </>
  );
  const twoLines = lastTs !== undefined && now !== undefined;
  return (
    <span className={twoLines ? "flex min-w-0 flex-col max-sm:gap-0.5 max-sm:py-2 sm:block" : "block min-w-0"}>
      <span className="flex min-w-0 items-baseline gap-2">
        {href ? (
          <a href={href} title={name || id} className="min-w-0 flex-1 truncate rounded-sm outline-hidden hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
            {label}
          </a>
        ) : (
          <span title={name || id} className="min-w-0 flex-1 truncate">
            {label}
          </span>
        )}
        {projectCwd && (
          <span className="min-w-0 max-w-[18ch] truncate font-mono max-sm:hidden text-xs text-fg-subtle" title={projectCwd}>
            {fmtProject(projectCwd)}
          </span>
        )}
      </span>
      {twoLines && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle sm:hidden">
          <SessionStatusBadge lastTs={lastTs} now={now} iconOnly />
          <span className="capitalize">{sessionStatus(lastTs, now)}</span>
          {projectCwd && <span className="min-w-0 truncate font-mono">· {fmtProject(projectCwd)}</span>}
          <span className="shrink-0">· <RelativeTime iso={lastTs} /></span>
        </span>
      )}
    </span>
  );
}
