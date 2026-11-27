import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn.ts";

const GAP_PX = 4;
const EDGE_PX = 8;

export interface PopoverProps {
  trigger: (props: { popoverTarget: string; "aria-expanded": boolean }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  label: string;
}

/** Native-popover panel (top layer, Esc and light-dismiss built in), placed from the trigger rect and flipped above when there is no room below. */
export function Popover({ trigger, children, align = "start", label }: PopoverProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const place = () => {
    const el = ref.current;
    const btn = document.querySelector<HTMLElement>(`[popovertarget="${CSS.escape(id)}"]`);
    if (!el || !btn) return;
    const r = btn.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = el;
    const below = innerHeight - r.bottom - GAP_PX - EDGE_PX;
    const flip = h > below && r.top > below;
    const left = align === "end" ? r.right - w : r.left;
    el.style.left = `${Math.max(EDGE_PX, Math.min(left, innerWidth - w - EDGE_PX))}px`;
    el.style.top = `${flip ? Math.max(EDGE_PX, r.top - h - GAP_PX) : r.bottom + GAP_PX}px`;
    el.style.maxHeight = `${Math.max(160, flip ? r.top - GAP_PX - EDGE_PX : below)}px`;
  };

  return (
    <>
      {trigger({ popoverTarget: id, "aria-expanded": open })}
      <div
        ref={ref}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        onToggle={(e) => {
          setOpen(e.newState === "open");
          if (e.newState === "open") place();
        }}
        className={cn(
          "fixed inset-auto m-0 min-w-56 max-w-[calc(100vw-1rem)] overflow-auto rounded-md border bg-popover p-0 text-popover-foreground shadow-md",
        )}
      >
        {children}
      </div>
    </>
  );
}
