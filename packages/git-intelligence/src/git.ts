import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile, ChangeStatus, DiffSpec } from "./types";

/**
 * The git layer: runs git plumbing to discover changed files for a diff spec
 * (working tree, staged, or a branch/commit range). The *parser* is pure and
 * heavily tested; the *runner* shells out to git and is robust to a non-git
 * directory (returns empty rather than throwing).
 *
 * Cross-platform: uses `git diff --name-status -z`-free output and normalizes
 * paths to forward slashes.
 */

const run = promisify(execFile);

const STATUS_MAP: Record<string, ChangeStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "added",
  T: "modified",
};

/**
 * Parse `git diff --name-status` output into {@link ChangedFile}s. Handles
 * add/modify/delete and rename/copy (with similarity score + old→new paths).
 */
export function parseNameStatus(output: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0]!.trim();
    const letter = code[0]!;
    const status = STATUS_MAP[letter] ?? "modified";
    if ((letter === "R" || letter === "C") && parts.length >= 3) {
      out.push({
        path: norm(parts[2]!),
        oldPath: norm(parts[1]!),
        status: letter === "R" ? "renamed" : "added",
      });
    } else if (parts.length >= 2) {
      out.push({ path: norm(parts[1]!), status });
    }
  }
  return out;
}

/** Parse `git status --porcelain` for untracked files (shown as `?? path`). */
export function parseUntracked(output: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("?? "))
      out.push({ path: norm(line.slice(3)), status: "added" });
  }
  return out;
}

function norm(p: string): string {
  return p.trim().replace(/\\/g, "/");
}

/** The git arguments for a diff spec. Exposed for testing. */
export function diffArgs(spec: DiffSpec): string[] {
  if (spec.mode === "staged") return ["diff", "--name-status", "--cached"];
  if (spec.mode === "range") {
    const base = spec.base ?? "HEAD";
    const ref = spec.head ? `${base}...${spec.head}` : base;
    return ["diff", "--name-status", ref];
  }
  // working tree vs HEAD (tracked changes).
  return ["diff", "--name-status", "HEAD"];
}

/** Discover the changed files for a diff spec. Never throws (empty on failure). */
export async function getChangedFiles(
  cwd: string,
  spec: DiffSpec,
): Promise<ChangedFile[]> {
  const files = await safeGit(cwd, diffArgs(spec)).then(parseNameStatus);
  // For the working tree, also include untracked (new) files.
  if (spec.mode === "working") {
    const untracked = await safeGit(cwd, ["status", "--porcelain"]).then(
      parseUntracked,
    );
    return dedupe([...files, ...untracked]);
  }
  return dedupe(files);
}

async function safeGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

function dedupe(files: ChangedFile[]): ChangedFile[] {
  const seen = new Map<string, ChangedFile>();
  for (const f of files) if (!seen.has(f.path)) seen.set(f.path, f);
  return [...seen.values()];
}
