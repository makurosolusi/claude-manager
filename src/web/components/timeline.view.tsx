import { useState } from "react";
import type { Page, TimelineItem } from "../../server/dashboard.types.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { StatusView } from "@/components/status.view.tsx";
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
  const state = useApi<Page<TimelineItem>>(`/api/sessions/${encodeURIComponent(sessionId)}/timeline`, { page, pageSize: size }, tick);
  return (
    <StatusView state={state} isEmpty={(d) => d.items.length === 0} emptyText="No prompts recorded.">
      {(d) => (
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
                  <span>{fmtInt(t.requests)} requests</span>
                  <span>{fmtTokens(t.input)} in</span>
                  <span>{fmtTokens(t.output)} out</span>
                  <span>{fmtTokens(t.cache_read)} cache read</span>
                  <span>{fmtTokens(t.cache_write)} cache write</span>
                  <CostCell usd={t.cost_usd} unpriced={t.unpriced} />
                </div>
              </li>
            ))}
          </ol>
          <TablePagination label="Prompts" page={page} pageSize={size} total={d.total} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </>
      )}
    </StatusView>
  );
}
