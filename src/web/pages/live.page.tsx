import { useMemo, useState } from "react";
import type { PageProps } from "@/lib/page.props.ts";
import { Radio } from "lucide-react";
import type { LiveSession } from "../../server/dashboard.types.ts";
import { FAMILIES, SESSION_STATUSES, SESSION_STATUS_MIN } from "../../server/dashboard.types.ts";
import { ClientTable, type ClientGrouping } from "@/components/client.table.tsx";
import { CostCell } from "@/components/cost.cell.tsx";
import { LIVE_HIDEABLE, liveColumns } from "@/components/live.columns.tsx";
import { PageHeader } from "@/components/page.header.tsx";
import { useApi } from "@/lib/api.client.ts";
import { fmtProject, plural } from "@/lib/format.ts";
import { hashHref } from "@/lib/hash.route.ts";
import { FAMILY_ICON, LEVEL_ICON, NAV_ICON, STATUS_ICON, UI_ICON } from "@/lib/icon.map.ts";
import { GROUP_LEVEL, GROUP_PROJECT, LEVEL_LABEL, LIVE_PATH, LIVE_SPEC, levelOf, liveTableOptions } from "@/lib/live.table.ts";
import { FAMILY_LABEL } from "@/lib/model.tier.ts";
import { NOW_TICK_MS, useNow } from "@/lib/now.ts";
import { STATUS_TONE, LEVEL_TONE } from "@/lib/status.level.ts";
import { runClientTable } from "@/lib/table.client.ts";
import { NO_GROUP } from "@/lib/table.query.ts";
import { facetOptions, useTableView } from "@/lib/use.table.view.ts";
import type { ContextLevel } from "@/lib/context.level.ts";

const STATUS_LABEL = { live: "Live", idle: "Idle", ended: "Ended" } as const;
const LEVEL_NAME = { ok: "OK", warn: "Warning", danger: "Critical" } as const;
const LEVELS: ContextLevel[] = ["ok", "warn", "danger"];
const LEVEL_ORDER = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

const grouping: ClientGrouping<LiveSession> = {
  options: [{ value: NO_GROUP, label: "No grouping" }, { value: GROUP_PROJECT, label: "Project" }, { value: GROUP_LEVEL, label: "Context level" }],
  // Groups follow the active grouping; the table only calls these when one is selected.
  of: (s) => ({ key: s.project_cwd ?? "", label: <span className="font-mono text-xs">{fmtProject(s.project_cwd)}</span> }),
  totals: (rows) => ({ cost: <CostCell usd={rows.reduce((a, r) => a + r.cost_usd, 0)} /> }),
};
const levelGrouping: ClientGrouping<LiveSession> = {
  ...grouping,
  of: (s) => {
    const level = levelOf(s);
    const Icon = LEVEL_ICON[level];
    return { key: `${LEVEL_ORDER[level]}-${level}`, label: <span className="inline-flex items-center gap-2"><Icon aria-hidden className="size-4" />{LEVEL_LABEL[level]} context</span> };
  },
};

/** Active sessions (last 15 minutes) as a table: status, context meter and cost; refreshes only with the shell's `dataVersion`. */
export function LivePage({ dataVersion, params }: Omit<PageProps, "since">) {
  const [retry, setRetry] = useState(0);
  const view = useTableView({ id: "live", path: LIVE_PATH, params, spec: LIVE_SPEC, hideable: LIVE_HIDEABLE });
  const { data, error, loading } = useApi<LiveSession[]>("/api/live", {}, dataVersion + retry);
  const now = useNow(NOW_TICK_MS);
  const { state } = view;

  const opts = useMemo(() => liveTableOptions(now), [now]);
  const result = useMemo(() => (data ? runClientTable(data, state, opts) : undefined), [data, opts, JSON.stringify(state)]);
  const columns = useMemo(() => liveColumns(now), [now]);
  const set = (id: string) => (next: string[]) => view.go({ filters: { ...state.filters, [id]: next } });

  const facets = [
    { id: "status", label: "Status", icon: STATUS_ICON.live, options: facetOptions(SESSION_STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v], icon: STATUS_ICON[v], tone: STATUS_TONE[v] })), result?.counts.status), selected: state.filters.status ?? [], onChange: set("status") },
    { id: "level", label: "Context", icon: LEVEL_ICON.ok, options: facetOptions(LEVELS.map((v) => ({ value: v, label: LEVEL_NAME[v], icon: LEVEL_ICON[v], tone: LEVEL_TONE[v] })), result?.counts.level), selected: state.filters.level ?? [], onChange: set("level") },
    { id: "family", label: "Model", icon: UI_ICON.model, options: facetOptions(FAMILIES.map((v) => ({ value: v, label: FAMILY_LABEL[v], icon: FAMILY_ICON[v] })), result?.counts.family), selected: state.filters.family ?? [], onChange: set("family") },
  ];
  const n = data?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Live" icon={NAV_ICON.live} description={`Active in the last ${SESSION_STATUS_MIN.idle} minutes`} />
      <ClientTable
        label="Live sessions"
        noun="sessions"
        empty={<span className="inline-flex flex-col items-center gap-2"><Radio aria-hidden className="size-5" />No active sessions in the last {SESSION_STATUS_MIN.idle} minutes.</span>}
        view={view}
        columns={columns}
        facets={facets}
        searchPlaceholder="Search title, id or project…"
        grouping={state.group === GROUP_LEVEL ? levelGrouping : grouping}
        result={result}
        summary={error ? undefined : `${plural(n, "active session")}`}
        rowKey={(s) => s.id}
        rowHref={(s) => hashHref(`/sessions/${encodeURIComponent(s.id)}`)}
        loading={loading}
        error={error && new Error(`Couldn't load live sessions. ${error.message}`)}
        onRetry={() => setRetry((x) => x + 1)}
      />
    </div>
  );
}
