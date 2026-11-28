import { useState } from "react";
import { Pencil, Play, Power, Trash2 } from "lucide-react";
import type { AgentDetail, AgentWriteResult } from "../../server/agents.types.ts";
import { ConfirmDialog } from "@/components/confirm.dialog.tsx";
import { buttonVariants, Button } from "@/components/ui/button.tsx";
import { appliedText, holdNotice, toFailure, type Notice } from "@/lib/agent.write.ts";
import { sendJson } from "@/lib/api.write.ts";
import { cn } from "@/lib/cn.ts";

type Pending = "delete" | "disable" | null;
const BTN = "max-sm:min-h-11 max-sm:flex-1";

interface Props {
  agent: AgentDetail;
  /** Report a result on this page (same-page actions: enable/disable, errors). */
  onNotice: (n: Notice) => void;
  /** Refetch the detail so its etag is current. */
  onReload: () => void;
}

/** Detail actions: Edit (managed), Disable/Enable (preset), Delete (custom), each with its §5.4 confirm. */
export function AgentActions({ agent, onNotice, onReload }: Props) {
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/agents/${encodeURIComponent(agent.name)}`;
  const paths = agent.scopes.map((s) => s.path);

  async function run(kind: "delete" | "disable" | "enable") {
    setBusy(true);
    try {
      if (kind === "delete") {
        const r = await sendJson<{ removed: string; applied: number }>("DELETE", url, undefined, agent.etag);
        holdNotice({ tone: "success", text: appliedText("Deleted", agent.name, r.applied), live: true }, "/agents");
        location.hash = "#/agents";
      } else {
        const r = await sendJson<AgentWriteResult>("PATCH", url, { enabled: kind === "enable" }, agent.etag);
        onNotice({ tone: "success", text: appliedText(kind === "enable" ? "Enabled" : "Disabled", agent.name, r.applied), live: true });
        onReload();
      }
    } catch (err) {
      const f = toFailure(err);
      onNotice({ tone: "danger", text: f.reload ? `${f.text} Reloaded the latest version; try again.` : f.text });
      if (f.reload) onReload();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 max-sm:w-full">
      <a href={`#/agents/${encodeURIComponent(agent.name)}?edit=1`} className={cn(buttonVariants({ variant: "outline" }), BTN)}><Pencil aria-hidden />Edit</a>
      {agent.kind === "preset" && (agent.status === "enabled"
        ? <Button variant="outline" className={BTN} onClick={() => setPending("disable")}><Power aria-hidden />Disable</Button>
        : <Button variant="outline" className={BTN} disabled={busy} onClick={() => run("enable")}><Play aria-hidden />Enable</Button>)}
      {agent.kind === "custom" && <Button variant="outline" className={BTN} onClick={() => setPending("delete")}><Trash2 aria-hidden />Delete</Button>}
      {agent.kind === "custom" && <ConfirmDialog open={pending === "delete"} destructive busy={busy} title={`Delete ${agent.name}?`} confirmLabel="Delete" onCancel={() => setPending(null)} onConfirm={() => run("delete")}
        body={<>Removes it from claude-manager and deletes {paths.length ? paths.map((p, i) => <span key={p}>{i > 0 && ", "}<code className="font-mono text-xs break-all">{p}</code></span>) : "its installed files"}. A file you had before claude-manager is restored from backup.</>} />}
      {agent.kind === "preset" && <ConfirmDialog open={pending === "disable"} destructive busy={busy} title={`Disable ${agent.name}?`} confirmLabel="Disable" onCancel={() => setPending(null)} onConfirm={() => run("disable")}
        body={<>Its file is removed from every install; you can re-enable it here or with <code className="font-mono text-xs">claude-manager roles enable {agent.name}</code>.</>} />}
    </div>
  );
}
