import { join } from "node:path";
import { appDir } from "../app.paths.ts";

/** Compiled snapshot the hook reads (spec §2.6). Standalone so the hook never imports sqlite. */
export const policySnapshotPath = () => join(appDir(), "policy.compiled.json");

/** Live audit file the hook appends to (spec §2.7). The ingest module re-exports it as `policyAuditPath`. */
export const policyAuditFilePath = () => join(appDir(), "policy-audit.jsonl");
