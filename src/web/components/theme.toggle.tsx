import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn.ts";

/** localStorage key; the pre-paint script in index.html reads the same key. */
export const THEME_STORAGE_KEY = "cm-theme";

export type ThemeChoice = "system" | "light" | "dark";

const OPTIONS = [
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
] as const;

/** Stored theme choice; "system" when unset, invalid, or storage is unavailable. */
export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // Storage blocked (private mode, sandboxed iframe): follow the OS theme.
    return "system";
  }
}

/** Applies a choice to <html data-theme> (absent = follow OS) and persists it when storage allows. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view, it just won't survive a reload.
  }
}

/** System / light / dark segmented control for the app header. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return (
    <div role="group" aria-label="Theme" className="inline-flex shrink-0 rounded-md border p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={choice === value}
          onClick={() => {
            applyTheme(value);
            setChoice(value);
          }}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring",
            choice === value ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
