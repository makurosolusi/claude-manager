import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { UI_ICON } from "@/lib/icon.map.ts";

const RESET_MS = 1500;

/** Button that copies `text` to the clipboard and flashes a check (or a warning when the browser refuses). */
export function CopyButton({ text, label, withLabel }: { text: string; label: string; withLabel?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), RESET_MS);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch (e) {
      console.warn(`copy "${label}" failed`, e);
      setState("failed");
    }
  };
  const Icon = state === "copied" ? Check : state === "failed" ? TriangleAlert : UI_ICON.copy;
  return (
    <Button type="button" variant="ghost" size={withLabel ? "xs" : "icon-xs"} onClick={copy} aria-label={label} className="shrink-0 max-sm:min-h-11 max-sm:min-w-11">
      <Icon aria-hidden />
      {withLabel && (state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy")}
    </Button>
  );
}
