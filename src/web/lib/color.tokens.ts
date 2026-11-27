import type { ModelFamily } from "./model.tier.ts";

/** Colour classes for one hue: tinted badge, text-only, and mark (dot/bar) fill. Static strings so Tailwind can see them. */
export interface HueClasses {
  badge: string;
  text: string;
  dot: string;
}

/** Semantic tone keys (PLAN/05 §1.4). */
export type ToneKey = "success" | "warning" | "danger" | "info" | "neutral";
/** Preset-role colour slot (1 = manager … 6 = writer). */
export type RoleSlot = 1 | 2 | 3 | 4 | 5 | 6;

/** Role as served by `/api/meta` `roles`; `source` tells presets from custom roles. */
export interface RoleMeta {
  name: string;
  tier: "think" | "work" | "basic";
  source: "preset" | "custom";
}

/** Model-family hues (the only data hue that means "family"). */
export const FAMILY_CLASSES: Record<ModelFamily, HueClasses> = {
  opus: { badge: "border-model-opus-border bg-model-opus-bg text-model-opus-fg", text: "text-model-opus-fg", dot: "bg-model-opus" },
  sonnet: { badge: "border-model-sonnet-border bg-model-sonnet-bg text-model-sonnet-fg", text: "text-model-sonnet-fg", dot: "bg-model-sonnet" },
  haiku: { badge: "border-model-haiku-border bg-model-haiku-bg text-model-haiku-fg", text: "text-model-haiku-fg", dot: "bg-model-haiku" },
  fable: { badge: "border-model-fable-border bg-model-fable-bg text-model-fable-fg", text: "text-model-fable-fg", dot: "bg-model-fable" },
  other: { badge: "border-model-other-border bg-model-other-bg text-model-other-fg", text: "text-model-other-fg", dot: "bg-model-other" },
};

/** Semantic tone hues. */
export const TONE_CLASSES: Record<ToneKey, HueClasses> = {
  success: { badge: "border-tone-success-border bg-tone-success-bg text-tone-success-fg", text: "text-tone-success-fg", dot: "bg-tone-success" },
  warning: { badge: "border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg", text: "text-tone-warning-fg", dot: "bg-tone-warning" },
  danger: { badge: "border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg", text: "text-tone-danger-fg", dot: "bg-tone-danger" },
  info: { badge: "border-tone-info-border bg-tone-info-bg text-tone-info-fg", text: "text-tone-info-fg", dot: "bg-tone-info" },
  neutral: { badge: "border-tone-neutral-border bg-tone-neutral-bg text-tone-neutral-fg", text: "text-tone-neutral-fg", dot: "bg-tone-neutral" },
};

/** Role slot hues, indexed by slot - 1. */
export const ROLE_CLASSES: readonly HueClasses[] = [
  { badge: "border-role-1-border bg-role-1-bg text-role-1-fg", text: "text-role-1-fg", dot: "bg-role-1" },
  { badge: "border-role-2-border bg-role-2-bg text-role-2-fg", text: "text-role-2-fg", dot: "bg-role-2" },
  { badge: "border-role-3-border bg-role-3-bg text-role-3-fg", text: "text-role-3-fg", dot: "bg-role-3" },
  { badge: "border-role-4-border bg-role-4-bg text-role-4-fg", text: "text-role-4-fg", dot: "bg-role-4" },
  { badge: "border-role-5-border bg-role-5-bg text-role-5-fg", text: "text-role-5-fg", dot: "bg-role-5" },
  { badge: "border-role-6-border bg-role-6-bg text-role-6-fg", text: "text-role-6-fg", dot: "bg-role-6" },
];

/** Preset role → colour slot; fixed so presets never move (tier order think → work → basic). */
export const PRESET_SLOTS: Readonly<Record<string, RoleSlot>> = {
  manager: 1,
  architect: 2,
  coder: 3,
  reviewer: 4,
  researcher: 5,
  writer: 6,
};

/** Keys with no role colour: the main thread and generic subagents. */
export const NEUTRAL_ROLES: readonly string[] = ["main", "subagent"];

/** 32-bit FNV-1a hash of a string (UTF-16 code units); stable across sessions and pages. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Resolved role colour: `slot` is null for neutral roles; `custom` roles render dashed. */
export interface RoleColor {
  slot: RoleSlot | null;
  custom: boolean;
}

/** Colour slot for a role name: neutral for main/subagent, fixed for presets, `fnv1a32 % 6 + 1` (dashed) for the rest. */
export function roleColor(name: string, roles?: readonly RoleMeta[]): RoleColor {
  if (NEUTRAL_ROLES.includes(name)) return { slot: null, custom: false };
  const source = roles?.find((r) => r.name === name)?.source;
  const preset = Object.hasOwn(PRESET_SLOTS, name) ? PRESET_SLOTS[name] : undefined;
  if (preset && source !== "custom") return { slot: preset, custom: false };
  return { slot: (fnv1a32(name) % 6 + 1) as RoleSlot, custom: true };
}
