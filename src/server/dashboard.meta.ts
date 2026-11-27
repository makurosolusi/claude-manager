import { loadConfigSync, type Config } from "../config/config.store.ts";
import { resolveRoles } from "../roles/roles.registry.ts";
import type { MetaProvider } from "./dashboard.api.ts";
import type { DashboardMeta, SyncMeta } from "./dashboard.types.ts";

type ConfigMeta = Pick<DashboardMeta, "tiers" | "roles">;

const fromConfig = (config: Config): ConfigMeta => ({
  tiers: config.tiers,
  roles: resolveRoles(config).map((r) => ({ name: r.name, tier: r.tier, source: r.source })),
});

/** Meta provider that re-reads the config on every call, so `roles add` / tier changes show up without restarting the dashboard; an unreadable config keeps the last good tiers and roles and reports the problem in `error`. */
export function liveMeta(state: SyncMeta, load: () => Config = loadConfigSync): MetaProvider {
  let last = fromConfig(load());
  return () => {
    let error = state.error;
    try {
      last = fromConfig(load());
    } catch (e) {
      // Config mid-edit or malformed: keep serving the last good snapshot rather than failing /api/meta, but tell the user why roles look stale.
      // A sync error takes precedence: it is the older, more fundamental problem.
      error ??= `config.json is invalid: ${e instanceof Error ? e.message : String(e)}; showing last valid roles`;
    }
    return { ...state, error, ...last };
  };
}
