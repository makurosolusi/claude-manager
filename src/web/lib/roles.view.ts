import { NEUTRAL_ROLES } from "./color.tokens.ts";
import { TIER_ORDER, type TierKey } from "./model.tier.ts";
import { sumUsage, type TieredRow } from "./roles.aggregate.ts";

/** How the Roles table is grouped: one group per role, per model id or per billed tier. */
export type RolesView = "role" | "model" | "tier";
/** Views in switch order. */
export const ROLES_VIEWS: readonly RolesView[] = ["role", "model", "tier"];
/** View when the URL names none. */
export const DEFAULT_VIEW: RolesView = "role";
export const VIEW_LABEL: Record<RolesView, string> = { role: "By role", model: "By model", tier: "By tier" };
/** The pre-v0.3 `group` query values and the view each one became. */
const LEGACY_GROUP: Record<string, RolesView> = { tier: "tier", role: "role", family: "model" };

/** View from `?view=`, else from a legacy `?group=` link, else the default; never throws. */
export function parseView(params: URLSearchParams): RolesView {
  const v = params.get("view");
  if (ROLES_VIEWS.includes(v as RolesView)) return v as RolesView;
  return LEGACY_GROUP[params.get("group") ?? ""] ?? DEFAULT_VIEW;
}

/** Next view for an arrow/Home/End key on the switch; undefined for other keys. */
export function viewForKey(cur: RolesView, key: string): RolesView | undefined {
  const i = ROLES_VIEWS.indexOf(cur);
  const n = ROLES_VIEWS.length;
  if (key === "ArrowRight" || key === "ArrowDown") return ROLES_VIEWS[(i + 1) % n];
  if (key === "ArrowLeft" || key === "ArrowUp") return ROLES_VIEWS[(i + n - 1) % n];
  if (key === "Home") return ROLES_VIEWS[0];
  if (key === "End") return ROLES_VIEWS[n - 1];
  return undefined;
}

/** Group key of a row in a view. */
export const groupKeyOf = (view: RolesView, r: TieredRow): string => (view === "role" ? r.role : view === "model" ? r.model : r.tier);

/** Rows grouped for a view: tiers in TIER_ORDER, roles and models by summed cost desc (ties by key). Row order inside a group is kept. */
export function groupRows(rows: readonly TieredRow[], view: RolesView): { key: string; rows: TieredRow[] }[] {
  const m = new Map<string, TieredRow[]>();
  for (const r of rows) {
    const k = groupKeyOf(view, r);
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  const groups = [...m].map(([key, rs]) => ({ key, rows: rs }));
  if (view === "tier") return groups.sort((a, b) => TIER_ORDER.indexOf(a.key as TierKey) - TIER_ORDER.indexOf(b.key as TierKey));
  return groups.sort((a, b) => sumUsage(b.rows).cost_usd - sumUsage(a.rows).cost_usd || a.key.localeCompare(b.key));
}

/** Where the "View agent" link goes, or undefined for main/subagent (not agents you can manage). */
export const agentHref = (role: string): string | undefined => (NEUTRAL_ROLES.includes(role) ? undefined : `#/agents/${encodeURIComponent(role)}`);

/** Open flags after "Expand all" / "Collapse all": the keys to flip from the default (`collapsed` = default closed). */
export const flipsFor = (keys: readonly string[], open: boolean, collapsed: boolean): string[] => (open === collapsed ? [...keys] : []);
