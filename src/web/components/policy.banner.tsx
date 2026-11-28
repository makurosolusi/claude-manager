import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button.tsx";
import { TONE_CLASSES } from "@/lib/color.tokens.ts";
import { useWriteMode } from "@/lib/agent.write.ts";
import { policyBanner } from "@/lib/policy.status.ts";
import { usePolicy } from "@/lib/policy.use.ts";
import type { PolicyResponse } from "../../server/policy.types.ts";

const POLICY_HREF = "#/policy";

/** Policy status banner (§6.1): no dismiss, shown until the policy is enforced; renders nothing while loading or enforced. */
export function PolicyBanner({ policy, readOnly }: { policy: PolicyResponse | undefined; readOnly: boolean }) {
  const b = policyBanner(policy ?? null, readOnly);
  if (!b) return null;
  const danger = b.tone === "error";
  const hue = TONE_CLASSES[danger ? "danger" : b.tone === "info" ? "info" : "warning"];
  const href = b.cta?.href ?? POLICY_HREF;
  return (
    <div role={danger ? "alert" : "status"} className={`flex flex-col gap-3 rounded-md border px-3 py-2.5 text-sm sm:flex-row sm:items-center ${hue.badge}`}>
      <ShieldAlert aria-hidden className="hidden size-4 shrink-0 sm:block" />
      <div className="min-w-0 flex-1">
        <p>{b.text}</p>
        {b.hint && <p className="mt-1 font-mono text-xs break-words">{b.hint}</p>}
      </div>
      {b.cta && <a href={href} className={buttonVariants({ className: "max-sm:min-h-11 max-sm:w-full" })}>{b.cta.label}</a>}
    </div>
  );
}

/** Self-fetching banner for pages that don't otherwise need the policy (Overview). */
export function PolicyBannerHost({ tick }: { tick: number }) {
  const { data } = usePolicy(tick);
  return <PolicyBanner policy={data} readOnly={useWriteMode() === false} />;
}
