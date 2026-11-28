import type { PolicyInput, PolicyPreview, PolicyWriteResult } from "../../server/policy.types.ts";
import type { PresetName } from "../../policy/policy.types.ts";
import { sendJson } from "./api.write.ts";
import type { PatchRequest } from "./policy.matrix.ts";

const BASE = "/api/policy";

/** Dry run: the settings changes `input` would make (writes nothing). */
export const previewPolicy = (input: PolicyInput, etag: string): Promise<PolicyPreview> =>
  sendJson("POST", `${BASE}/preview`, input, etag);

/** Applies `input` and turns the policy on (`confirm: true` is always sent; the UI confirms first). */
export const enablePolicy = (input: PolicyInput, etag: string): Promise<PolicyWriteResult> =>
  sendJson("PUT", BASE, { ...input, confirm: true }, etag);

/** Applies a preset at a scope. */
export const applyPreset = (preset: PresetName, scope: PolicyInput["scope"], etag: string, extra: Partial<PolicyInput> = {}): Promise<PolicyWriteResult> =>
  enablePolicy({ ...extra, preset, scope }, etag);

/** Turns the policy off (settings reverted, matrix kept). */
export const disablePolicy = (etag: string): Promise<PolicyWriteResult> => sendJson("DELETE", BASE, undefined, etag);

/** Sets cells of one row. */
export const setCell = (row: string, body: PatchRequest["body"], etag: string): Promise<PolicyWriteResult> =>
  sendJson("PATCH", `${BASE}/rows/${encodeURIComponent(row)}`, body, etag);

/** Sends staged patches one by one, threading each result's etag into the next call; returns the last result. */
export async function applyPatches(patches: PatchRequest[], etag: string): Promise<PolicyWriteResult | null> {
  let last: PolicyWriteResult | null = null;
  for (const p of patches) {
    last = await setCell(p.row, p.body, last?.etag ?? etag);
  }
  return last;
}
