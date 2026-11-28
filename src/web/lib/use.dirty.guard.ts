import { useCallback, useEffect, useRef, useState } from "react";

const norm = (h: string) => h.replace(/^#/, "") || "/";

/** True when leaving `prevHash` for a different `nextHash` would discard unsaved changes (query-only changes count; identical hashes do not). */
export function shouldBlock(prevHash: string, nextHash: string, dirty: boolean): boolean {
  return dirty && norm(prevHash) !== norm(nextHash);
}

export interface DirtyGuard {
  /** Hash the user tried to reach while dirty, or null. Show the confirm dialog while non-null. */
  pending: string | null;
  /** Discard: navigate to `pending` without re-triggering the guard. */
  confirmDiscard: () => void;
  /** Keep editing: drop `pending`. */
  keepEditing: () => void;
  /** Navigate to `target` (a hash such as "#/agents") now if clean, otherwise set `pending`. */
  guard: (target: string) => void;
}

/** Warns before losing unsaved edits: `beforeunload` while dirty, and hash navigation is held until the user confirms. */
export function useDirtyGuard(dirty: boolean): DirtyGuard {
  const [pending, setPending] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const prev = useRef(location.hash);
  const allow = useRef(false);

  useEffect(() => {
    // Capture phase + stopImmediatePropagation so the router never sees a blocked hash and keeps showing this page.
    const onHash = (e: Event) => {
      const next = location.hash;
      if (allow.current) allow.current = false;
      else if (shouldBlock(prev.current, next, dirtyRef.current)) {
        e.stopImmediatePropagation();
        history.replaceState(null, "", prev.current || "#/");
        setPending(next);
        return;
      }
      prev.current = next;
    };
    addEventListener("hashchange", onHash, true);
    return () => removeEventListener("hashchange", onHash, true);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", onUnload);
    return () => removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const guard = useCallback((target: string) => {
    if (shouldBlock(location.hash, target, dirtyRef.current)) setPending(target);
    else location.hash = target;
  }, []);
  const confirmDiscard = useCallback(() => {
    if (pending === null) return;
    allow.current = true;
    setPending(null);
    location.hash = pending;
  }, [pending]);
  const keepEditing = useCallback(() => setPending(null), []);
  return { pending, confirmDiscard, keepEditing, guard };
}
