import type { Database } from "bun:sqlite";
import { CliError } from "../cli.error.ts";
import { gitRoot } from "../commands/policy.command.apply.ts";
import type { ConfigBuild } from "../config/config.apply.ts";
import { type Config, loadConfig } from "../config/config.store.ts";
import { loadManifest } from "../install/install.manifest.ts";
import { applyPolicy, previewPolicy } from "../policy/policy.apply.ts";
import { assertCells, isPresetName, PRESET_NAMES } from "../policy/policy.presets.ts";
import { applyPreset, disablePolicy, setCell, setOverrides } from "../policy/policy.service.ts";
import { errorResponse, fail, managedBlocks, policyResponse, STATUS, trim } from "./policy.api.ts";
import type { PolicyInput, PolicyPreview, PolicyWriteResult } from "./policy.types.ts";
import { checkWrite, type WriteSession } from "./write.guard.ts";

const ROW_PATH = /^\/api\/policy\/rows\/([^/]+)$/;
const INPUT_KEYS = new Set(["preset", "scope", "overrides", "defaultMode", "testCommands"]);

/** True for POST /api/policy/preview, PUT|DELETE /api/policy, PATCH /api/policy/rows/:row (§4.2 `isPolicyWriteRoute`). */
export function isPolicyWriteRoute(method: string, pathname: string): boolean {
  const path = trim(pathname);
  if (path === "/api/policy") return method === "PUT" || method === "DELETE";
  if (path === "/api/policy/preview") return method === "POST";
  return method === "PATCH" && ROW_PATH.test(path);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates a PolicyInput body (400s) and returns the config transform; `extra` names keys allowed on top (PUT's `confirm`). */
function inputBuild(body: unknown, extra: string[] = []): ConfigBuild {
  if (!isObject(body)) throw new CliError("body must be a JSON object");
  const unknown = Object.keys(body).find((k) => !INPUT_KEYS.has(k) && !extra.includes(k));
  if (unknown) throw new CliError(`unknown field "${unknown}"`);
  const input = body as unknown as PolicyInput;
  if (!isPresetName(input.preset)) throw new CliError(`unknown preset "${String(input.preset)}". Use ${PRESET_NAMES.join(", ")}`);
  if (input.scope !== "user" && input.scope !== "project") throw new CliError(`invalid scope "${String(input.scope)}": use "user" or "project"`);
  const projectDir = input.scope === "project" ? gitRoot() : undefined;
  return (config: Config) => {
    const next = applyPreset(config, input.preset, input.scope, { projectDir, defaultMode: input.defaultMode, testCommands: input.testCommands });
    return input.overrides === undefined ? next : setOverrides(next, input.overrides);
  };
}

/** PATCH body → one `setCell` per capability, in order; push allow and bad cells are 400 before the row lookup. */
function rowBuild(row: string, body: unknown): ConfigBuild {
  if (!isObject(body) || !Object.keys(body).length) throw new CliError("body must be a JSON object of capability → decision");
  assertCells(body, row);
  return (config: Config) => Object.entries(body).reduce((c, [cap, d]) => setCell(c, row, cap, d as string), config);
}

/** 409 when managed settings would make an enabled policy ineffective (§5). */
async function assertNotBlocked(): Promise<void> {
  const [reason] = await managedBlocks();
  if (reason) throw new CliError(reason, 1, "conflict");
}

async function preview(body: unknown): Promise<Response> {
  const build = inputBuild(body);
  await assertNotBlocked();
  const plan = await previewPolicy(await build(await loadConfig(), await loadManifest()));
  const result: PolicyPreview = { changes: plan.changes, settings_path: plan.settingsPath ?? "", rows: plan.rows, etag: plan.etag };
  return Response.json(result);
}

function writeBuild(method: string, path: string, body: unknown): ConfigBuild {
  if (method === "DELETE") return disablePolicy;
  if (method === "PUT") {
    if (!isObject(body) || body.confirm !== true) throw new CliError("PUT /api/policy needs \"confirm\": true");
    return inputBuild(body, ["confirm"]);
  }
  return rowBuild(decodeURIComponent(ROW_PATH.exec(path)![1]!), body);
}

/** Policy writes (Host check already done): write guard, If-Match, validate, then `applyPolicy` under the config lock. */
export async function routePolicyWrite(req: Request, db: Database, pathname: string, session: WriteSession, port: number): Promise<Response> {
  const checked = await checkWrite(req, { ...session, port, isWriteRoute: isPolicyWriteRoute(req.method, pathname) });
  if (!checked.ok) return checked.res;
  const path = trim(pathname);
  const what = `${req.method} ${path}`;
  try {
    if (path === "/api/policy/preview") return await preview(checked.body);
    const ifMatch = req.headers.get("if-match");
    if (ifMatch === null) return fail(STATUS.noEtag, "If-Match header is required");
    const build = writeBuild(req.method, path, checked.body);
    if (req.method !== "DELETE") await assertNotBlocked();
    const { plan } = await applyPolicy(build, { expectedEtag: ifMatch });
    const policy = await policyResponse(db);
    // applyPolicy's own etag hashes the reverted file after a disable; the GET etag is what the next write checks.
    const result: PolicyWriteResult = { policy, changes: plan.changes, etag: policy.etag };
    return Response.json(result);
  } catch (err) {
    if (err instanceof URIError) return fail(STATUS.badRequest, `${what}: invalid row encoding`);
    return errorResponse(err, what);
  }
}
