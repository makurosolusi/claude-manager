import { fmtRelative, fmtTime } from "@/lib/format.ts";
import { useNow } from "@/lib/now.ts";

/** `<time>` showing age ("5m ago"), absolute date-time on hover; "—" when null. Ticks via the shared `useNow`. */
export function RelativeTime({ iso }: { iso: string | null }) {
  const now = useNow();
  if (!iso) return <span className="text-fg-subtle">—</span>;
  return (
    <time dateTime={iso} title={fmtTime(iso)} className="whitespace-nowrap tabular-nums">
      {fmtRelative(iso, now)}
    </time>
  );
}
