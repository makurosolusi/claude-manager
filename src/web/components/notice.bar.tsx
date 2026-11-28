import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";

/** Auto-dismiss delay per tone; danger/warning/info stay until closed. */
export const NOTICE_AUTO_DISMISS_MS = { success: 8000 } as const;

interface Props {
  tone: "success" | "danger" | "warning" | "info";
  children: ReactNode;
  onClose: () => void;
  /** Override the tone default; 0 disables auto-dismiss. */
  autoDismissMs?: number;
}

/** Inline notice bar; success/info are polite status, danger is an alert. */
export function NoticeBar({ tone, children, onClose, autoDismissMs }: Props) {
  const ms = autoDismissMs ?? (tone === "success" ? NOTICE_AUTO_DISMISS_MS.success : 0);
  useEffect(() => {
    if (!ms) return;
    const t = setTimeout(onClose, ms);
    return () => clearTimeout(t);
  }, [ms, onClose, children]);

  const alert = tone === "danger";
  return (
    <div
      role={alert ? "alert" : "status"}
      aria-live={alert ? undefined : "polite"}
      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm ${TONE_CLASSES[tone].badge}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        aria-label="Dismiss notice"
        onClick={onClose}
        className="shrink-0 rounded-sm p-0.5 outline-hidden hover:opacity-70 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
