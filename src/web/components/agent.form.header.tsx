import { PageHeader } from "@/components/page.header.tsx";

export const FORM_SUBTITLE = "Create a subagent Claude Code can delegate to.";

/** Header for the create/edit form: a "‹ back" link above the title and subtitle. */
export function AgentFormHeader({ backHref, backLabel, title }: { backHref: string; backLabel: string; title: string }) {
  return (
    <>
      <a href={backHref} className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
        <span aria-hidden>‹</span>{backLabel}
      </a>
      <PageHeader title={title} description={FORM_SUBTITLE} />
    </>
  );
}
