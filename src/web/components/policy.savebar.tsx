import { ConfirmDialog } from "@/components/confirm.dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { DirtyGuard } from "@/lib/use.dirty.guard.ts";

interface Props { count: number; busy: boolean; onSave: () => void; onDiscard: () => void; guard: DirtyGuard }

/** Sticky "N changes" bar with Discard and Save, plus the leave-page confirm of the dirty guard. */
export function PolicySaveBar({ count, busy, onSave, onDiscard, guard }: Props) {
  return (
    <>
      {count > 0 && (
        <div role="status" className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t bg-card/95 px-4 py-3 backdrop-blur">
          <span className="text-sm font-medium">{count} change{count === 1 ? "" : "s"}</span>
          <span className="flex gap-2">
            <Button className="min-h-11 sm:min-h-0" variant="outline" disabled={busy} onClick={onDiscard}>Discard</Button>
            <Button className="min-h-11 sm:min-h-0" disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save"}</Button>
          </span>
        </div>
      )}
      <ConfirmDialog open={guard.pending !== null} title="Discard unsaved changes?" body="You have matrix edits that are not saved." confirmLabel="Discard" cancelLabel="Keep editing" destructive onConfirm={guard.confirmDiscard} onCancel={guard.keepEditing} />
    </>
  );
}
