import type { Config } from "../config/config.store.ts";
import { ownValue, resolveRoles } from "../roles/roles.registry.ts";
import { CAPABILITIES, isCellAllowed, isDecision, isPresetName, MAIN_ROW, presetRow, RECOMMENDED_PRESET, RESERVED_ROWS, UNKNOWN_ROW } from "./policy.presets.ts";
import type { PolicyMatrix, PolicyRow } from "./policy.types.ts";

// Kept out of policy.eval.ts so the hook's fast path never loads roles, config or role prompts.

/** Effective matrix rows: main, every enabled role, unknown (§2.2). `push` is never `allow`, whatever config.json says. */
export function effectivePolicy(config: Config): PolicyRow[] {
  const policy = config.policy;
  // Absent policy previews the recommended preset; a present but invalid preset name falls back to the strictest.
  const preset = policy ? (isPresetName(policy.preset) ? policy.preset : "strict") : RECOMMENDED_PRESET;
  const overrides = policy?.overrides && typeof policy.overrides === "object" ? policy.overrides : {};
  const row = (name: string, kind: PolicyRow["kind"], tier?: Parameters<typeof presetRow>[3]): PolicyRow => {
    const base = presetRow(preset, name, kind, tier);
    const patch = ownValue(overrides, name);
    const cells = Object.fromEntries(CAPABILITIES.map((cap) => {
      const o = patch && typeof patch === "object" && Object.hasOwn(patch, cap) ? patch[cap] : undefined;
      return [cap, isDecision(o) && isCellAllowed(cap, o) ? { decision: o, source: "override" } : { decision: base[cap], source: "preset" }];
    })) as PolicyRow["cells"];
    return { row: name, kind, cells };
  };
  // A role named "main"/"unknown" would collide with a reserved row, so it gets no row and runs as `unknown`.
  const roles = resolveRoles(config).filter((r) => !RESERVED_ROWS.includes(r.name));
  return [row(MAIN_ROW, "main"), ...roles.map((r) => row(r.name, r.source, r.tier)), row(UNKNOWN_ROW, "unknown")];
}

/** Snapshot `matrix` from effective rows. */
export const matrixOf = (rows: PolicyRow[]): PolicyMatrix =>
  Object.fromEntries(rows.map((r) => [r.row, Object.fromEntries(CAPABILITIES.map((c) => [c, r.cells[c].decision]))])) as PolicyMatrix;
