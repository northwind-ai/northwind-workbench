import { readFile, readdir, stat } from "node:fs/promises";

/**
 * Tiny filesystem helpers shared by the workspace adapters. All are
 * failure-tolerant — a missing/unreadable/malformed file resolves to a safe
 * empty value, never a throw. This is what lets detection "never crash on a
 * malformed workspace file" (a hard requirement).
 */

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

/** Read + parse JSON, returning null on any read/parse failure. */
export async function readJsonSafe<T = unknown>(p: string): Promise<T | null> {
  const text = await readText(p);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function listDirNames(p: string): Promise<string[]> {
  try {
    const entries = await readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
