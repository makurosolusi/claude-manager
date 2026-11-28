import { Lock } from "lucide-react";
import { Panel } from "@/components/panel.tsx";
import { OWNER_ASK_RULES, SECRET_DENY_RULES } from "../../policy/policy.presets.ts";

const Rules = ({ title, rules }: { title: string; rules: readonly string[] }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <h3 className="text-xs font-medium text-foreground">{title}</h3>
    <ul className="flex flex-wrap gap-1">
      {rules.map((r) => <li key={r} className="rounded-sm border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] break-all">{r}</li>)}
    </ul>
  </div>
);

/** Read-only list of the rules the policy always writes: owner-only asks and secret denies. */
export function PolicyFloors() {
  return (
    <Panel title="Owner floors" action={<Lock aria-hidden className="size-3.5 text-muted-foreground" />}>
      <p className="text-sm text-muted-foreground">
        Nobody can switch these off from the UI. Workers always ask you first for push, publish, deploy and recursive delete, and never read secrets.
        <code className="mx-1 font-mono text-xs">.env.example</code>is covered too: read it yourself or through the owner.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Rules title="Always ask the owner" rules={OWNER_ASK_RULES} />
        <Rules title="Always denied (secrets)" rules={SECRET_DENY_RULES} />
      </div>
    </Panel>
  );
}
