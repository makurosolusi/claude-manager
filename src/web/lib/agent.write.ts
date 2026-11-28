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

/** Whether the dashboard accepts writes: null until `/api/session` has answered (a failed fetch counts as read-only). */
export function useWriteMode(): boolean | null {
  const [write, setWrite] = useState<boolean | null>(getSession()?.write ?? null);
  useEffect(() => {
    loadSession().then((s) => setWrite(s.write), (e: unknown) => { console.warn("session load failed", e); setWrite(false); });
  }, []);
  return write;
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
