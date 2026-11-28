import { NoticeBar } from "@/components/notice.bar.tsx";
import { AGENT_LIVE_NOTE } from "@/lib/agent.copy.ts";
import type { Notice } from "@/lib/agent.write.ts";

/** Page notice after a write (or a read-only redirect); success adds the live-pickup note. */
export function AgentNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <NoticeBar tone={notice.tone} onClose={onClose}>
      {notice.text}
      {notice.live && <span className="mt-0.5 block text-xs opacity-80">{AGENT_LIVE_NOTE}</span>}
    </NoticeBar>
  );
}
