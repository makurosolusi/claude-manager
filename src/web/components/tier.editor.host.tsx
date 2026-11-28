import { useState } from "react";
import type { AgentRow } from "../../server/agents.types.ts";
import type { TierWriteResult, TiersResponse } from "../../server/tiers.types.ts";
import { TierEditor } from "@/components/tier.editor.tsx";
import { useFrozenEtag } from "@/lib/agent.write.ts";
import type { Tier } from "@/lib/model.tier.ts";
import { saveTier, tierFailure } from "@/lib/tier.write.ts";

interface Props {
  tier: Tier;
  preselect?: string;
  data: TiersResponse;
  items: AgentRow[];
  onSaved: (r: TierWriteResult) => void;
  onClose: () => void;
  /** Refetch the tiers (the 412 Reload button). */
  onReload: () => void;
}

/** Mounted only while the tier editor is open: freezes the tiers etag, saves, and turns failures into the editor banner. */
export function TierEditorHost({ tier, preselect, data, items, onSaved, onClose, onReload }: Props) {
  const [etag, thaw] = useFrozenEtag(data.etag);
  const [failure, setFailure] = useState<{ text: string; reload: boolean }>();
  const summary = data.tiers.find((t) => t.tier === tier);
  if (!summary) return null;
  const save = async (model: string) => {
    setFailure(undefined);
    try { onSaved(await saveTier(tier, model, etag)); } catch (e) { setFailure(tierFailure(e)); }
  };
  return (
    <TierEditor
      open tier={summary} models={data.models} items={items} preselect={preselect}
      onSave={save} onClose={onClose} error={failure?.text}
      onReload={failure?.reload ? () => { setFailure(undefined); thaw(); onReload(); } : undefined}
    />
  );
}
