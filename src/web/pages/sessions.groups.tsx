import type { GroupRow, Page, SessionRow } from "../../server/dashboard.types.ts";
import { CostCell } from "@/components/cost.cell.tsx";
import type { GroupSpec } from "@/components/group.rows.tsx";
import { ToneBadge } from "@/components/tone.badge.tsx";
import { FAMILY_CLASSES } from "@/lib/color.tokens.ts";
import { cacheHitRate, fmtInt, fmtPct, fmtProject, fmtTokens } from "@/lib/format.ts";
import { FAMILY_ICON, STATUS_ICON, UI_ICON } from "@/lib/icon.map.ts";
import { FAMILY_LABEL, type ModelFamily } from "@/lib/model.tier.ts";
import { STATUS_TONE, type SessionStatus } from "@/lib/status.level.ts";
import type { Range } from "@/lib/range.ts";
import { sessionsApiPath, type GroupRef } from "@/lib/sessions.query.ts";
import { GROUP_PREVIEW_ROWS, type TableState } from "@/lib/table.query.ts";

const NO_PROJECT = "No project";

/** Header label for a group: family/status badge or project name with a folder icon. */
export function GroupLabel({ by, value }: { by: string; value: string }) {
  if (by === "family") return <ToneBadge hue={FAMILY_CLASSES[value as ModelFamily]} icon={FAMILY_ICON[value as ModelFamily]}>{FAMILY_LABEL[value as ModelFamily] ?? value}</ToneBadge>;
  if (by === "status") return <ToneBadge tone={STATUS_TONE[value as SessionStatus]} icon={STATUS_ICON[value as SessionStatus]}>{value.charAt(0).toUpperCase() + value.slice(1)}</ToneBadge>;
  const Icon = UI_ICON.project;
  return <span className="inline-flex min-w-0 items-center gap-1.5"><Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />{value ? fmtProject(value) : NO_PROJECT}</span>;
}

interface GroupCtx {
  state: TableState;
  since: string;
  range?: Range;
  open: readonly string[];
  results: Record<string, Page<SessionRow> | Error>;
  toggle: (key: string) => void;
  showAll: (ref: GroupRef) => void;
}

/** GroupSpecs for one page of groups: aggregate-first totals, collapsed by default, previews fetched on expand. */
export function groupSpecs(groups: GroupRow[], c: GroupCtx): GroupSpec<SessionRow>[] {
  return groups.map((g) => {
    const open = c.open.includes(g.key);
    const ref = { by: c.state.group, key: g.key };
    const res = c.results[sessionsApiPath(c.since, c.state, { only: ref, size: GROUP_PREVIEW_ROWS, range: c.range })];
    const page = res instanceof Error ? undefined : res;
    return {
      key: g.key,
      label: <GroupLabel by={ref.by} value={g.key} />,
      count: g.count,
      totals: {
        requests: fmtInt(g.requests),
        tokens: fmtTokens(g.input + g.output + g.cache_read + g.cache_write),
        cache: fmtPct(cacheHitRate(g)),
        cost: <CostCell usd={g.cost_usd} unpriced={g.unpriced} />,
      },
      open,
      onToggle: () => c.toggle(g.key),
      rows: res instanceof Error ? [] : page?.items,
      footer: res instanceof Error ? res.message : page && (
        <span className="inline-flex items-center gap-1">
          Showing {fmtInt(page.items.length)} of {fmtInt(page.total)} ·{" "}
          <button type="button" onClick={() => c.showAll(ref)} className="rounded-sm underline underline-offset-2 outline-hidden hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
            Show all →
          </button>
        </span>
      ),
    };
  });
}
