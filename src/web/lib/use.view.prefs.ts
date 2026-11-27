import { useState } from "react";
import { loadDensity, loadHiddenCols, saveDensity, saveHiddenCols, type Density } from "@/lib/table.prefs.ts";

/** Per-viewer table prefs (hidden columns, density) for table `id`, persisted to localStorage. */
export function useViewPrefs(id: string) {
  const [hidden, setHidden] = useState(() => loadHiddenCols(id));
  const [density, setDensityState] = useState<Density>(loadDensity);
  const toggleCol = (col: string) => setHidden((h) => {
    const next = h.includes(col) ? h.filter((x) => x !== col) : [...h, col];
    saveHiddenCols(id, next);
    return next;
  });
  const setDensity = (d: Density) => { setDensityState(d); saveDensity(d); };
  return { hidden, density, toggleCol, setDensity };
}
