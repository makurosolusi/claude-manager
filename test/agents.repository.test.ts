import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentUsage } from "../src/db/agents.repository.ts";
import { openDb } from "../src/db/db.schema.ts";
import { usageBy } from "../src/db/stats.repository.ts";
import { useTempHome } from "./test.home.ts";

// test-only fixtures: synthetic rows, never real logs.
useTempHome();
const SINCE = "2026-11-01T00:00:00.000Z";
let db: Database;
let n = 0;
beforeEach(() => {
  db = openDb();
  db.run("INSERT INTO sessions (id, main_agent) VALUES ('s1', NULL), ('s2', 'lead')");
  db.run("INSERT INTO agents (id, session_id, agent_type) VALUES ('a1', 's1', 'reviewer'), ('a2', 's1', NULL)");
});
afterEach(() => db.close());

function req(o: { agent?: string; session?: string; ts?: string; model?: string; requested?: string | null; cost?: number | null }) {
  db.run(
    `INSERT INTO requests (message_id, session_id, agent_id, ts, model, requested_model, input, cache_5m, cache_1h, cache_read, output, thinking, web_search, cost_usd, pricing_version, is_sidechain)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 1, 0, 0, ?, 'v', 0)`,
    [`m${n++}`, o.session ?? "s1", o.agent ?? null, o.ts ?? "2026-11-10T00:00:00.000Z", o.model ?? "claude-opus-5-5", o.requested ?? null, o.cost === undefined ? 1 : o.cost],
  );
}
const by = <T extends { role: string }>(rows: T[]): Record<string, T | undefined> => Object.fromEntries(rows.map((r) => [r.role, r]));

describe("agentUsage", () => {
  test("excludes rows before the window", () => {
    req({ agent: "a1", ts: "2026-10-31T23:59:59.000Z" });
    req({ agent: "a1", ts: "2026-11-01T00:00:00.000Z" });
    expect(by(agentUsage(db, SINCE)).reviewer?.requests).toBe(1);
  });

  test("last_ts is the max in the window", () => {
    req({ agent: "a1", ts: "2026-11-05T00:00:00.000Z" });
    req({ agent: "a1", ts: "2026-11-20T00:00:00.000Z" });
    req({ agent: "a1", ts: "2026-11-12T00:00:00.000Z" });
    expect(by(agentUsage(db, SINCE)).reviewer?.last_ts).toBe("2026-11-20T00:00:00.000Z");
  });

  test("rerouted is 0 for NULL requested_model and counts differing models", () => {
    req({ agent: "a1", requested: null });
    expect(by(agentUsage(db, SINCE)).reviewer?.rerouted).toBe(0);
    req({ agent: "a1", requested: "claude-sonnet-5-5", model: "claude-opus-5-5" });
    req({ agent: "a1", requested: "claude-opus-5-5-20260101", model: "claude-opus-5-5" }); // same model after normalizing
    expect(by(agentUsage(db, SINCE)).reviewer?.rerouted).toBe(1);
  });

  test("drops main and subagent keys, keeps session main agents", () => {
    req({ agent: "a2" }); // subagent without a type
    req({ session: "s1" }); // plain main
    req({ session: "s2" }); // claude --agent lead
    expect(Object.keys(by(agentUsage(db, SINCE)))).toEqual(["lead"]);
  });

  test("cost and unpriced match Roles -> By role", () => {
    req({ agent: "a1", cost: 1.5 });
    req({ agent: "a1", cost: null });
    req({ session: "s2", cost: 2 });
    const roles = by(usageBy(db, "role", { since: SINCE }, 100).map((r) => ({ ...r, role: r.key })));
    for (const u of agentUsage(db, SINCE)) {
      expect(u.cost_usd).toBe(roles[u.role]!.cost_usd);
      expect(u.unpriced).toBe(roles[u.role]!.unpriced);
      expect(u.requests).toBe(roles[u.role]!.requests);
    }
    expect(by(agentUsage(db, SINCE)).reviewer).toMatchObject({ cost_usd: 1.5, unpriced: 1 });
  });
});
