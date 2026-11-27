import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import type { Page, TimelineItem } from "../../server/dashboard.types.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { ModelBadge } from "@/components/model.badge.tsx";
import { TablePagination } from "@/components/table.pagination.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtInt, fmtTime, fmtTokens } from "@/lib/format.ts";
import { PAGE_SIZES } from "@/lib/table.query.ts";

/** Prompts per page until the viewer picks another size. */
const DEFAULT_TIMELINE_SIZE = PAGE_SIZES[0];

/** Prompts longer than this are folded until expanded. */
const PROMPT_PREVIEW_CHARS = 280;

function PromptText({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (text === null) return <p className="text-sm italic text-muted-foreground">(prompt text not stored)</p>;
  const long = text.length > PROMPT_PREVIEW_CHARS;
  return (
    <div className="flex flex-col items-start gap-1">
      {/* Rendered as a plain text node (never as HTML) so prompt content cannot inject markup. */}
      <pre className="w-full font-sans text-sm break-words whitespace-pre-wrap">{long && !open ? `${text.slice(0, PROMPT_PREVIEW_CHARS)}…` : text}</pre>
      {long && (
        <Button variant="link" size="xs" className="px-0" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}

/** Paginated user prompts of a session, each with the usage it triggered. */
export function Timeline({ sessionId, tick = 0 }: { sessionId: string; tick?: number }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_TIMELINE_SIZE);
  const [retry, setRetry] = useState(0);
  const { data: d, error, loading } = useApi<Page<TimelineItem>>(`/api/sessions/${encodeURIComponent(sessionId)}/timeline`, { page, pageSize: size }, tick + retry);
  if (!d) {
    return error ? (
      <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 p-3 text-sm">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
        <span className="min-w-0 break-words">Couldn't load prompts. {error.message}</span>
        <Button size="xs" variant="outline" onClick={() => setRetry((n) => n + 1)}>Retry</Button>
      </div>
    ) : (
      loading && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      )
    );
  }
  if (d.items.length === 0) return <p className="p-6 text-center text-sm text-muted-foreground">No prompts recorded.</p>;
  return (
    <>
      <ol className="flex flex-col divide-y">
        {d.items.map((t) => (
          <li key={t.uuid} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{fmtTime(t.ts)}</span>
              {t.source && <Badge variant="outline">{t.source}</Badge>}
              {t.models.map((m) => <ModelBadge key={m} model={m} />)}
            </div>
            <PromptText text={t.text} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>{fmtInt(t.requests)} {t.requests === 1 ? "request" : "requests"}</span>
              <span>{fmtTokens(t.input)} in</span>
              <span>{fmtTokens(t.output)} out</span>
              <span>{fmtTokens(t.cache_read)} cache read</span>
              <span>{fmtTokens(t.cache_write)} cache write</span>
              <CostCell usd={t.cost_usd} unpriced={t.unpriced} />
            </div>
          </li>
        ))}
      </ol>
      <TablePagination label="Prompts" noun="prompts" page={page} pageSize={size} total={d.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
    </>
  );
}
