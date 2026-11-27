import { CliError } from "../cli.error.ts";

/** Reads a JSON file; undefined when missing, CliError when malformed. */
export async function readJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new CliError(`invalid JSON in ${path}: ${(err as Error).message}`);
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
