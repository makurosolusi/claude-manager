import { loadConfigSync, type Config } from "../config/config.store.ts";
import { resolveRoles } from "../roles/roles.registry.ts";
import type { MetaProvider } from "./dashboard.api.ts";
import type { DashboardMeta, SyncMeta } from "./dashboard.types.ts";

type ConfigMeta = Pick<DashboardMeta, "tiers" | "roles">;

const fromConfig = (config: Config): ConfigMeta => ({
  tiers: config.tiers,
  roles: resolveRoles(config).map((r) => ({ name: r.name, tier: r.tier, source: r.source })),
});

/** Meta provider that re-reads the config on every call, so `roles add` / tier changes show up without restarting the dashboard; an unreadable config keeps the last good tiers and roles. */
export function liveMeta(state: SyncMeta, load: () => Config = loadConfigSync): MetaProvider {
  let last = fromConfig(load());
  return () => {
    try {
      last = fromConfig(load());
    } catch {
      // Config mid-edit or malformed: keep serving the last good snapshot rather than failing /api/meta.
    }
    return { ...state, ...last };
  };
}
