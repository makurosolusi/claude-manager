import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { run } from "../src/cli.ts";
import { openDb } from "../src/db/db.schema.ts";
import { applyPolicy, currentEtag } from "../src/policy/policy.apply.ts";
import { loadConfig } from "../src/config/config.store.ts";
import { loadManifest } from "../src/install/install.manifest.ts";
import { applyPreset, disablePolicy, enablePolicy, setCell } from "../src/policy/policy.service.ts";
import { handleRequest } from "../src/server/dashboard.api.ts";
import type { PolicyResponse, PolicyWriteResult } from "../src/server/policy.types.ts";
import type { WriteSession } from "../src/server/write.guard.ts";
import { useTempHome } from "./test.home.ts";

useTempHome();
const PORT = 5757;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "t".repeat(64); // test-only token
const RW: WriteSession = { readOnly: false, token: TOKEN };
let db: Database;

const quiet = async (argv: string[]) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await run(argv);
  } finally {
    console.log = log;
  }
};
const call = (req: Request) => handleRequest(req, db, PORT, undefined, RW) as Promise<Response>;
const send = (method: string, path: string, etag: string, body?: unknown) =>
  call(new Request(BASE + path, {
    method,
    headers: { origin: BASE, "x-cm-token": TOKEN, "content-type": "application/json", "if-match": etag },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
const getEtag = async () => ((await (await call(new Request(`${BASE}/api/policy`))).json()) as PolicyResponse).etag;
/** Status + returned etag; the etag must also equal what GET reports right after. */
async function step(method: string, path: string, etag: string, body?: unknown) {
  const res = await send(method, path, etag, body);
  expect(res.status).toBe(200);
  const r = (await res.json()) as PolicyWriteResult;
  expect(r.etag).toBe(await getEtag());
  return r.etag;
}
const PUT = { preset: "balanced", scope: "user", confirm: true };

beforeEach(async () => {
  db = openDb();
  await quiet(["install"]);
});
afterEach(() => db.close());

test("applyPolicy: enable -> disable -> enable -> set, each with the previous returned etag, never 412", async () => {
  let { etag } = await applyPolicy((c) => applyPreset(c, "balanced", "user"), { expectedEtag: await getEtag() });
  for (const build of [disablePolicy, enablePolicy, disablePolicy, (c: Parameters<typeof setCell>[0]) => setCell(c, "coder", "edit", "ask")]) {
    ({ etag } = await applyPolicy(build, { expectedEtag: etag }));
    expect(etag).toBe(await currentEtag(await loadConfig(), await loadManifest()));
  }
});

test("API: PUT -> DELETE -> PUT and DELETE -> PATCH -> PUT chain the returned etags", async () => {
  let etag = await step("PUT", "/api/policy", await getEtag(), PUT);
  etag = await step("DELETE", "/api/policy", etag);
  etag = await step("PUT", "/api/policy", etag, PUT);
  etag = await step("DELETE", "/api/policy", etag);
  etag = await step("PATCH", "/api/policy/rows/coder", etag, { edit: "ask" });
  await step("PUT", "/api/policy", etag, PUT);
});

test("a disabled policy's etag still covers its settings file: a hand edit before enable is 412", async () => {
  let etag = await step("PUT", "/api/policy", await getEtag(), PUT);
  etag = await step("DELETE", "/api/policy", etag);
  const settings = Bun.file(`${process.env.CLAUDE_CONFIG_DIR}/settings.json`);
  await Bun.write(settings, `${await settings.text()}\n`);
  expect((await send("PUT", "/api/policy", etag, PUT)).status).toBe(412);
});
