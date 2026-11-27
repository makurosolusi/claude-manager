/** Error expected by the user (bad input, conflict); printed without stack. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export function formatError(err: unknown): string {
  if (err instanceof CliError) return `error: ${err.message}`;
  const e = err as { code?: string; message?: string; stack?: string };
  if (e?.code?.startsWith("ERR_PARSE_ARGS")) return `error: ${e.message}`;
  if (process.env.CLAUDE_MANAGER_DEBUG) return `error: ${e?.stack ?? String(err)}`;
  return `error: ${e?.message ?? String(err)}\n(set CLAUDE_MANAGER_DEBUG=1 for details)`;
}
