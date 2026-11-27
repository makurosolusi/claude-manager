import { ToneBadge } from "@/components/tone.badge.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { cn } from "@/lib/cn.ts";
import { STATUS_ICON, STOP_ICON } from "@/lib/icon.map.ts";
import { STATUS_TONE, sessionStatus, stopTone } from "@/lib/status.level.ts";
import { CircleSlash } from "lucide-react";

const STATUS_LABEL = { live: "Live", idle: "Idle", ended: "Ended" } as const;

/** Session status: tone + icon + word (live icon pulses under `motion-safe`); `iconOnly` keeps an aria-label. */
export function SessionStatusBadge({ lastTs, now, iconOnly }: { lastTs: string | null | undefined; now: number; iconOnly?: boolean }) {
  const status = sessionStatus(lastTs, now);
  const Icon = STATUS_ICON[status];
  const tone = STATUS_TONE[status];
  if (iconOnly) {
    return (
      <span role="img" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]} className={cn("inline-flex", TONE_CLASSES[tone].text)}>
        <Icon aria-hidden className={cn("size-3.5", status === "live" && "motion-safe:animate-pulse")} />
      </span>
    );
  }
  return (
    <ToneBadge tone={tone} icon={Icon} className={status === "live" ? "[&_svg]:motion-safe:animate-pulse" : undefined}>
      {STATUS_LABEL[status]}
    </ToneBadge>
  );
}

/** Stop reason badge (icon + mono reason, tone by severity); null renders an em dash. */
export function StopReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return <span className="text-muted-foreground">—</span>;
  const icon = Object.hasOwn(STOP_ICON, reason) ? STOP_ICON[reason]! : CircleSlash;
  return (
    <ToneBadge tone={stopTone(reason)} icon={icon} className="font-mono">
      {reason}
    </ToneBadge>
  );
}
