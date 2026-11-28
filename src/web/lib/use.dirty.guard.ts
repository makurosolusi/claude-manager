import { useCallback, useEffect, useRef, useState } from "react";
import { proceedStep, registerNavBlocker, type NavBlocker, type NavKind } from "./hash.route.ts";

const norm = (h: string) => h.replace(/^#/, "") || "/";

/** True when leaving `prevHash` for a different `nextHash` would discard unsaved changes (query-only changes count; identical hashes do not). */
export function shouldBlock(prevHash: string, nextHash: string, dirty: boolean): boolean {
  return dirty && norm(prevHash) !== norm(nextHash);
}

export interface Blocker {
  /** The router-facing check: true holds the navigation and reports its target through `onBlock`. */
  check: NavBlocker;
  /** Let exactly the next navigation through (Discard). */
  allowNext: () => void;
}

/** Pure blocker core: blocks while `isDirty()`, reports the held target, and lets one navigation pass after `allowNext`. */
export function createBlocker(isDirty: () => boolean, onBlock: (target: string, kind: NavKind) => void): Blocker {
  let allow = false;
  return {
    allowNext: () => { allow = true; },
    check: (prev, next, kind) => {
      if (norm(prev) === norm(next)) return false;
      if (allow) { allow = false; return false; }
      if (!shouldBlock(prev, next, isDirty())) return false;
      onBlock(next, kind);
      return true;
    },
  };
}

export interface DirtyGuard {
  /** Hash the user tried to reach while dirty, or null. Show the confirm dialog while non-null. */
  pending: string | null;
  /** Discard: navigate to `pending` without re-triggering the guard. */
  confirmDiscard: () => void;
  /** Keep editing: drop `pending`. */
  keepEditing: () => void;
  /** Navigate to `target` (a hash such as "#/agents"); the router blocker holds it while dirty. */
  guard: (target: string) => void;
}

/** Warns before losing unsaved edits: `beforeunload` while dirty, and a router blocker holds hash navigation until the user confirms. */
export function useDirtyGuard(dirty: boolean): DirtyGuard {
  const [pending, setPending] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useRef<Blocker | null>(null);
  const heldKind = useRef<NavKind>("push");

  useEffect(() => {
    const b = createBlocker(() => dirtyRef.current, (target, kind) => { heldKind.current = kind; setPending(target); });
    blocker.current = b;
    const off = registerNavBlocker(b.check);
    return () => { off(); blocker.current = null; };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", onUnload);
    return () => removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const guard = useCallback((target: string) => { location.hash = target; }, []);
  const confirmDiscard = useCallback(() => {
    if (pending === null) return;
    blocker.current?.allowNext();
    setPending(null);
    // Repeat a blocked Back/Forward as the same traversal so history stays linear; only a link click needs a new entry.
    const step = proceedStep(heldKind.current);
    if (step === "assign") location.hash = pending; else history[step]();
  }, [pending]);
  const keepEditing = useCallback(() => setPending(null), []);
  return { pending, confirmDiscard, keepEditing, guard };
}
