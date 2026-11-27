export type Settings = Record<string, unknown>;

/** Key paths are "agent" or "<section>.<key>" (e.g. "env.ANTHROPIC_DEFAULT_OPUS_MODEL"). */
function split(path: string): [string | undefined, string] {
  const dot = path.indexOf(".");
  return dot < 0 ? [undefined, path] : [path.slice(0, dot), path.slice(dot + 1)];
}

function section(obj: Settings, name: string | undefined, create: boolean): Settings | undefined {
  if (!name) return obj;
  const value = obj[name];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Settings;
  if (!create) return undefined;
  obj[name] = {};
  return obj[name] as Settings;
}

export function getKey(obj: Settings, path: string): unknown {
  const [sec, key] = split(path);
  return section(obj, sec, false)?.[key];
}

/** Sets a key; `undefined` deletes it. */
export function setKey(obj: Settings, path: string, value: unknown): void {
  const [sec, key] = split(path);
  const target = section(obj, sec, value !== undefined);
  if (!target) return;
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** Restores a key to `prev` only if it still holds the value we wrote. */
export function revertKey(obj: Settings, path: string, rec: { prev?: unknown; written: unknown }): void {
  if (Bun.deepEquals(getKey(obj, path), rec.written)) setKey(obj, path, rec.prev);
}

export function pruneEmptySections(obj: Settings, paths: string[]): void {
  for (const path of paths) {
    const [sec] = split(path);
    const value = sec ? obj[sec] : undefined;
    if (sec && value && typeof value === "object" && Object.keys(value).length === 0) delete obj[sec];
  }
}
