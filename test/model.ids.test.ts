import { expect, test } from "bun:test";
import { TIER_ALIAS } from "../src/config/config.store.ts";
import { TIER_ALIAS_MAP } from "../src/roles/model.ids.ts";
import { TIER_ALIAS as WEB_ALIAS } from "../src/web/lib/agents.hierarchy.ts";

test("every copy of the tier → alias map agrees", () => {
  expect(TIER_ALIAS).toEqual(TIER_ALIAS_MAP);
  expect(WEB_ALIAS).toEqual(TIER_ALIAS_MAP);
});
