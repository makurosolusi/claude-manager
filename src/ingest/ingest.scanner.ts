import { basename, join } from "node:path";

export interface LogFile {
  path: string;
  sessionId: string;
  /** Set for subagent transcripts (…/<session>/subagents/[workflows/<wf>/]agent-<id>.jsonl). */
  agentId: string | null;
}

/** Every transcript under ~/.claude/projects: <project>/<session>.jsonl plus nested subagent files. */
export function listLogFiles(root: string): LogFile[] {
  const files: LogFile[] = [];
  for (const rel of new Bun.Glob("**/*.jsonl").scanSync({ cwd: root, onlyFiles: true })) {
    const parts = rel.split("/");
    if (parts.length === 2) {
      files.push({ path: join(root, rel), sessionId: basename(rel, ".jsonl"), agentId: null });
      continue;
    }
    const agent = /^agent-(.+)\.jsonl$/.exec(parts.at(-1)!);
    if (agent && parts[2] === "subagents") files.push({ path: join(root, rel), sessionId: parts[1]!, agentId: agent[1]! });
  }
  // Main files first, so a session's cwd comes from its own transcript rather than a subagent worktree.
  return files.sort((a, b) => Number(a.agentId !== null) - Number(b.agentId !== null));
}

const CHUNK_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;

/**
 * Feeds complete lines in [start, end) to onLine and returns the offset after the last newline.
 * A trailing line without "\n" is still being written, so it is left for the next sync.
 */
export async function readLines(path: string, start: number, end: number, onLine: (line: string) => void): Promise<number> {
  const file = Bun.file(path);
  const decoder = new TextDecoder();
  let offset = start;
  let size = CHUNK_BYTES;
  while (offset < end) {
    const bytes = await file.slice(offset, Math.min(end, offset + size)).bytes();
    const nl = bytes.lastIndexOf(NEWLINE);
    if (nl === -1) {
      if (offset + bytes.length >= end) break;
      size *= 2; // one line longer than the chunk
      continue;
    }
    for (const line of decoder.decode(bytes.subarray(0, nl)).split("\n")) if (line) onLine(line);
    offset += nl + 1;
    size = CHUNK_BYTES;
  }
  return offset;
}
