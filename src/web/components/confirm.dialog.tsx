import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";

const FOCUS = "outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring";
const DANGER = "border border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg hover:bg-tone-danger-bg/70";

interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Label of the dismiss button; default "Cancel". */
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirm built on native `<dialog>`; `open` is the single source of truth.
 * Esc cancels; a backdrop click deliberately does nothing so a stray click never dismisses a destructive prompt.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "Cancel", destructive, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-b`}
      onCancel={(e) => {
        // Keep the dialog open until the parent flips `open`, so React state and the DOM never disagree.
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className={`m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg backdrop:bg-black/50 ${FOCUS}`}
    >
      <h2 id={`${id}-t`} className="text-base font-semibold">{title}</h2>
      <div id={`${id}-b`} className="mt-2 text-sm text-muted-foreground">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" autoFocus disabled={busy} onClick={onCancel} className={FOCUS}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? "outline" : "default"}
          disabled={busy}
          onClick={onConfirm}
          className={`${destructive ? DANGER : ""} ${FOCUS}`}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
