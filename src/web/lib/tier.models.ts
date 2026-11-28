import { ALIAS_VALUES, MODEL_ID_MAX, MODEL_ID_RE } from "../../roles/model.ids.ts";
import { FAMILY_LABEL, modelFamily, normalizeModel, type ModelFamily } from "./model.tier.ts";

export interface ModelVersion { family: ModelFamily; major: number; minor: number }

const VERSION_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?$/;
const GROUP_ORDER: readonly ModelFamily[] = ["opus", "sonnet", "haiku", "fable", "other"];

/** Family + version of a full Claude model id (date suffix and `[1m]` ignored); null when it doesn't parse. */
export function modelVersion(id: string): ModelVersion | null {
  const m = VERSION_RE.exec(normalizeModel(id));
  return m ? { family: m[1] as ModelFamily, major: Number(m[2]), minor: Number(m[3] ?? 0) } : null;
}

/** Same normalization as the server's `normalizeModelId` (tiers.catalog.ts): keys of `estimate_30d` and `models[].id`. */
export const normalizeModelId = normalizeModel;

const cmp = (a: ModelVersion, b: ModelVersion) => a.major - b.major || a.minor - b.minor;

/** True when `id` is a strictly newer version than `current` within the same family. */
export function isNewer(id: string, current: string): boolean {
  const a = modelVersion(id), b = modelVersion(current);
  return !!a && !!b && a.family === b.family && cmp(a, b) > 0;
}

/** Highest model strictly newer than `current` in the same family, or null. */
export function newerInFamily(current: string, models: readonly { id: string }[]): string | null {
  let best: { id: string; v: ModelVersion } | null = null;
  for (const { id } of models) {
    const v = modelVersion(id);
    if (v && isNewer(id, current) && (!best || cmp(v, best.v) > 0)) best = { id, v };
  }
  return best?.id ?? null;
}

const LONG_CONTEXT_RE = /\[1m\]$/i;

/** Newer model hint for `current`: like `newerInFamily`, but keeps a `[1m]` suffix the current model has. */
export function newerSuggestion(current: string, models: readonly { id: string }[]): string | null {
  const id = newerInFamily(current, models);
  return id && LONG_CONTEXT_RE.test(current.trim()) && !LONG_CONTEXT_RE.test(id) ? `${id}[1m]` : id;
}

/** True when `sel` is a valid id that differs from the stored `current` as written (a `[1m]` or date suffix counts). */
export const selectionChanged = (sel: string, current: string): boolean => !validateModelId(sel) && sel.trim() !== current.trim();

export interface FamilyGroup<T> { family: ModelFamily; label: string; items: T[] }

/** Non-empty family groups in Opus, Sonnet, Haiku, Fable, Other order; version descending inside each. */
export function groupByFamily<T extends { id: string }>(models: readonly T[]): FamilyGroup<T>[] {
  const byVersion = (a: T, b: T) => {
    const va = modelVersion(a.id), vb = modelVersion(b.id);
    if (va && vb) return cmp(vb, va) || b.id.localeCompare(a.id);
    return va ? -1 : vb ? 1 : a.id.localeCompare(b.id);
  };
  return GROUP_ORDER.map((family) => ({
    family,
    label: FAMILY_LABEL[family],
    items: models.filter((m) => modelFamily(m.id) === family).sort(byVersion),
  })).filter((g) => g.items.length > 0);
}

const rate = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** `$4 in · $20 out / MTok`, or "No price known" when either rate is missing. */
export function fmtPrice(input: number | null, output: number | null): string {
  return input == null || output == null ? "No price known" : `${rate(input)} in · ${rate(output)} out / MTok`;
}

/** True for the alias words Claude Code accepts instead of a model id. */
export const isAliasValue = (v: string) => ALIAS_VALUES.includes(v.trim().toLowerCase());

/** Error text for an invalid tier model, or null when the value is a full pinnable model id. */
export function validateModelId(v: string): string | null {
  const s = v.trim();
  if (!s) return "model id is required";
  if (isAliasValue(s)) return `model must be a full model ID, not the alias "${s}"`;
  if (s.length > MODEL_ID_MAX || !MODEL_ID_RE.test(s)) return `invalid model id "${s.slice(0, 40)}"`;
  return null;
}
