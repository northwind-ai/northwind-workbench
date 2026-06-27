import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Best-effort git provenance read directly from `.git` (no child process, so it
 * works in restricted CI). Returns whatever it can determine; everything is
 * optional.
 */

export interface GitInfo {
  branch?: string;
  commit?: string;
}

async function findGitDir(start: string): Promise<string | null> {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    try {
      const head = join(dir, ".git", "HEAD");
      await readFile(head, "utf8");
      return join(dir, ".git");
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export async function readGitInfo(cwd: string): Promise<GitInfo> {
  const gitDir = await findGitDir(cwd);
  if (!gitDir) return {};
  try {
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
    const refMatch = head.match(/^ref:\s*(.+)$/);
    if (!refMatch) {
      // Detached HEAD — the file holds the commit sha.
      return /^[0-9a-f]{7,40}$/i.test(head) ? { commit: head } : {};
    }
    const ref = refMatch[1]!;
    const branch = ref.replace(/^refs\/heads\//, "");
    const commit = await resolveRef(gitDir, ref);
    return { branch, commit };
  } catch {
    return {};
  }
}

async function resolveRef(
  gitDir: string,
  ref: string,
): Promise<string | undefined> {
  try {
    return (await readFile(join(gitDir, ref), "utf8")).trim();
  } catch {
    // Fall back to packed-refs.
    try {
      const packed = await readFile(join(gitDir, "packed-refs"), "utf8");
      for (const line of packed.split("\n")) {
        const [sha, name] = line.split(" ");
        if (name === ref && sha) return sha.trim();
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }
}
