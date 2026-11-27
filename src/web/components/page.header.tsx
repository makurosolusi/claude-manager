import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Page title (h1) with an optional 16px muted icon, muted description line and right-aligned actions. */
export function PageHeader({ title, description, actions, icon: Icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.01em] text-foreground">
          {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          {title}
        </h1>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
