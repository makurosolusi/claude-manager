import { useEffect, useState } from "react";
import { ApiWriteError, getSession, loadSession } from "./api.write.ts";
import { fieldForError, type FormErrors } from "./agent.form.ts";

export const READ_ONLY_REASON = "Started with --read-only. Restart without it to make changes.";

export interface Notice { tone: "success" | "danger" | "info"; text: string; /** Append the "running sessions pick this up" note. */ live?: boolean }

// Notice handed across a hash navigation: addressed to one route path and consumed once, by that route.
let held: { notice: Notice; to: string } | null = null;
/** Keeps `n` for the page at route path `to` (e.g. "/agents/ui-ux"); any other page that looks drops it. */
export const holdNotice = (n: Notice, to: string): void => { held = { notice: n, to }; };
/** Returns the notice held for `to` and always clears the slot, so a different route can never inherit it. */
export const takeNotice = (to: string): Notice | null => { const h = held; held = null; return h?.to === to ? h.notice : null; };

/** Notice state for the page at route `path`; `key` (path + query) is the route identity. The notice is bound to the key it was set under, so it never shows on another route. */
export function useNotice(path: string, key: string): [Notice | null, (n: Notice | null) => void] {
  const [state, setState] = useState<{ key: string; notice: Notice | null } | null>(null);
  useEffect(() => { setState({ key, notice: takeNotice(path) }); }, [key]);
  return [state?.key === key ? state.notice : null, (n) => setState({ key, notice: n })];
}

/** Edit permission: unknown until `/api/session` answers; `error` = the check itself failed (not the same as `read-only`). */
export type WriteStatus = "loading" | "write" | "read-only" | "error";

/** Maps the session answer (or its failure) to a status. */
export const writeStatusOf = (s: { write: boolean } | Error | null): WriteStatus => (s === null ? "loading" : s instanceof Error ? "error" : s.write ? "write" : "read-only");

/** Edit permission plus a `retry` for the `error` state. */
export function useWriteStatus(): { status: WriteStatus; retry: () => void } {
  const [status, setStatus] = useState<WriteStatus>(writeStatusOf(getSession()));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    loadSession().then((s) => setStatus(writeStatusOf(s)), (e: unknown) => { console.warn("session load failed", e); setStatus("error"); });
  }, [attempt]);
  return { status, retry: () => { setStatus("loading"); setAttempt((n) => n + 1); } };
}

/** Boolean view of `useWriteStatus`: null while unknown or when the check failed, so callers show neither controls nor the read-only badge. */
export function useWriteMode(): boolean | null {
  const { status } = useWriteStatus();
  return status === "write" ? true : status === "read-only" ? false : null;
}

/** Snapshot an editor works from: kept for the whole edit so background refetches cannot move it (null = not editing / nothing to freeze yet). */
export function nextFrozen<T>(frozen: T | null, editing: boolean, live: T | undefined): T | null {
  return !editing ? null : frozen ?? live ?? null;
}

/** `If-Match` etag frozen at mount: a background refetch must not move it, or a change made elsewhere would never answer 412. `thaw()` adopts the next live etag (the Reload banner). */
export function useFrozenEtag(live: string): [string, () => void] {
  const [etag, setEtag] = useState(live);
  const [thawing, setThawing] = useState(false);
  useEffect(() => {
    if (thawing && live !== etag) { setEtag(live); setThawing(false); }
  }, [thawing, live, etag]);
  return [etag, () => setThawing(true)];
}

export interface WriteFailure { field: keyof FormErrors | null; text: string; reload: boolean }

/** Maps a failed write to a field error (400 naming a field), a Reload banner (412) or a plain banner. */
export function toFailure(err: unknown): WriteFailure {
  if (!(err instanceof ApiWriteError)) return { field: null, text: err instanceof Error ? err.message : String(err), reload: false };
  if (err.status === 400) return { field: fieldForError(err.serverMessage), text: err.serverMessage, reload: false };
  if (err.status === 412) return { field: null, text: `This agent changed since you opened it (${err.serverMessage}).`, reload: true };
  return { field: null, text: err.serverMessage, reload: false };
}

/** "Saved x · applied to N installs." */
export const appliedText = (verb: string, name: string, applied: number): string => `${verb} ${name} · applied to ${applied} install${applied === 1 ? "" : "s"}.`;
