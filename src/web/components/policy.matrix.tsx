import { useEffect, useState } from "react";
import { Panel } from "@/components/panel.tsx";
import { PolicyCell } from "@/components/policy.cell.tsx";
import { PolicySaveBar } from "@/components/policy.savebar.tsx";
import { RoleBadge } from "@/components/role.badge.tsx";
import type { RoleMeta } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { useFrozenEtag } from "@/lib/agent.write.ts";
import { applyPatches } from "@/lib/policy.write.ts";
import {
  countLine, diffToPatches, discardStaging, isDirty, newStaging, rowsForDisplay, stageCell, stagedRows, summarizeRow, type Staging,
} from "@/lib/policy.matrix.ts";
import { useDirtyGuard } from "@/lib/use.dirty.guard.ts";
import { CAPABILITIES } from "../../policy/policy.presets.ts";
import type { PolicyResponse } from "../../server/policy.types.ts";

const TH = "px-2 py-2 text-left text-xs font-medium text-muted-foreground";
const KIND_NOTE: Record<string, string> = { main: "your own session", unknown: "built-in and other agents" };

interface Props { policy: PolicyResponse; editable: boolean; roles?: readonly RoleMeta[]; onSaved: (text: string) => void; onFailure: (e: unknown) => void }

/** Matrix editor: rows × capabilities with staged edits, a sticky Save/Discard bar and an unsaved-changes guard. */
export function PolicyMatrix({ policy, editable, roles, onSaved, onFailure }: Props) {
  const [staging, setStaging] = useState<Staging>(() => newStaging(policy.rows));
  const [etag, thaw] = useFrozenEtag(policy.etag);
  const [busy, setBusy] = useState(false);
  const dirty = isDirty(staging);
  const guard = useDirtyGuard(dirty);
  const moved = policy.etag !== etag;
  // Adopt fresh server data whenever nothing is staged; while dirty the etag stays frozen so a change elsewhere answers 412.
  useEffect(() => { if (!dirty && moved) thaw(); }, [dirty, moved]);
  useEffect(() => { if (!dirty) setStaging(newStaging(policy.rows)); }, [policy.rows, dirty]);
  const tiers = Object.fromEntries((roles ?? []).map((r) => [r.name, r.tier]));
  const rows = stagedRows(staging);
  const patches = diffToPatches(staging.initial, rows);
  const cellCount = patches.reduce((n, p) => n + Object.keys(p.body).length, 0);

  const save = async () => {
    setBusy(true);
    try {
      await applyPatches(patches, etag);
      setStaging(newStaging(rows));
      onSaved(`Saved ${cellCount} change${cellCount === 1 ? "" : "s"}. Running sessions pick them up within seconds.`);
    } catch (e) { onFailure(e); } finally { setBusy(false); }
  };

  return (
    <Panel title="What each agent may do">
      <p className="text-xs text-muted-foreground">Default means Claude Code's own mode and rules decide. Push can be Ask or Deny, never Allow.</p>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
          <thead><tr><th className={TH}>Agent</th>{CAPABILITIES.map((c) => <th key={c} className={cn(TH, c === "mcp" ? "uppercase" : "capitalize")}>{c}</th>)}</tr></thead>
          <tbody>
            {rowsForDisplay(rows, tiers).map((r) => (
              <tr key={r.row} className="border-t">
                <th scope="row" className="border-t px-2 py-1.5 text-left font-normal">
                  <RoleBadge role={r.row} roles={roles} />
                  {KIND_NOTE[r.kind] && <span className="mt-0.5 block text-[11px] text-muted-foreground">{KIND_NOTE[r.kind]}</span>}
                </th>
                {CAPABILITIES.map((c) => (
                  <td key={c} className="border-t px-2 py-1.5">
                    <PolicyCell row={r} cap={c} editable={editable} staged={staging.edits[r.row]?.[c] !== undefined} onChange={(d) => setStaging(stageCell(staging, r.row, c, d))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        {rowsForDisplay(rows, tiers).map((r) => (
          <details key={r.row} className="rounded-md border">
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring">
              <RoleBadge role={r.row} roles={roles} />
              <span className="text-xs text-muted-foreground">{countLine(r)}</span>
              <span className="basis-full text-[11px] text-muted-foreground">{summarizeRow(r)}</span>
            </summary>
            <ul className="flex flex-col divide-y border-t">
              {CAPABILITIES.map((c) => (
                <li key={c} className="flex items-center justify-between gap-2 px-3 py-1">
                  <span className={cn("text-sm", c === "mcp" ? "uppercase" : "capitalize")}>{c}</span>
                  <PolicyCell row={r} cap={c} editable={editable} staged={staging.edits[r.row]?.[c] !== undefined} onChange={(d) => setStaging(stageCell(staging, r.row, c, d))} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      {editable && <PolicySaveBar count={cellCount} busy={busy} onSave={save} onDiscard={() => setStaging(discardStaging(staging))} guard={guard} />}
    </Panel>
  );
}
