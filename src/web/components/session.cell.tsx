import { fmtProject } from "@/lib/format.ts";

/** Visible length of the id shown for untitled sessions. */
const SHORT_ID_LEN = 8;

interface SessionCellProps {
  id: string;
  title: string | null;
  projectCwd: string | null;
  /** Link target for the title. Omit inside a DataTable with `rowHref`, which already wraps the cell in a link. */
  href?: string;
}

/** One-line session label: title (or "Untitled session" + short id), then the dimmed `acme/web` project. */
export function SessionCell({ id, title, projectCwd, href }: SessionCellProps) {
  const name = title?.trim();
  const label = name ? (
    <span className="text-foreground">{name}</span>
  ) : (
    <>
      <span className="text-muted-foreground italic">Untitled session</span>{" "}
      <span className="font-mono text-xs text-fg-subtle">{id.slice(0, SHORT_ID_LEN)}</span>
    </>
  );
  return (
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
  );
}
