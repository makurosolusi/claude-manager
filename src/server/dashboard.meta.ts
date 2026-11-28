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
      // The config message goes first: it is actionable, while a sync error caused by the same broken file is only a vaguer echo of it.
      const config = `${e instanceof Error ? e.message : String(e)} — fix it or run claude-manager doctor`;
      error = state.error ? `${config}; sync also failed: ${state.error}` : config;
    }
    return { ...state, error, ...last };
  };
}
