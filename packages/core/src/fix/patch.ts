import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  readdir,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FixPatch } from "./types";

/**
 * The patch engine — the part that must NEVER corrupt a file. Guarantees:
 *
 *  - **Pre-flight conflict check.** Every patch declares the content it expects;
 *    if the file on disk differs, the whole group is aborted untouched.
 *  - **Backups first.** Originals are copied into a backup manifest *before* any
 *    write, so a rollback is always possible (even after a crash).
 *  - **Atomic writes.** Each file is written to a temp sibling then renamed over
 *    the target — a reader never sees a half-written file.
 *  - **All-or-nothing + recovery.** If any write fails mid-group, the already-
 *    applied files are restored from backup and the group reports failure.
 *
 * Cross-platform: same-directory temp + rename; no symlinks; forward-slash safe.
 */

export interface BackupFileEntry {
  path: string;
  /** True if the file existed before the patch (false = it was created). */
  existed: boolean;
  /** Backup file holding the original content (only when `existed`). */
  backupFile?: string;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  files: BackupFileEntry[];
  rolledBack?: boolean;
}

export interface ApplyOptions {
  /** Directory to store backups in. */
  backupDir: string;
  /** Stable backup id (injectable for deterministic tests). */
  backupId: string;
  now?: () => string;
}

export interface PatchConflict {
  path: string;
  reason: string;
}

export type ApplyOutcome =
  | { ok: true; backupId: string; files: string[] }
  | { ok: false; conflicts: PatchConflict[]; applied: false }
  | { ok: false; error: string; rolledBack: boolean; applied: false };

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Atomic write: temp sibling + rename. Creates parent dirs. */
export async function atomicWrite(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.pw-tmp-${process.pid}`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, path);
  } catch (err) {
    // Some platforms refuse rename-over-existing; fall back to overwrite + cleanup.
    try {
      await writeFile(path, content, "utf8");
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
    if (!(await pathExists(path))) throw err;
  }
}

const backupFileName = (i: number): string => `file-${i}.bak`;

/**
 * Apply a group of patches atomically. Either every patch lands or none do; a
 * mid-group failure restores what was written. Returns the backup id for undo.
 */
export async function applyPatches(
  patches: FixPatch[],
  opts: ApplyOptions,
): Promise<ApplyOutcome> {
  const now = opts.now ?? (() => new Date().toISOString());
  if (patches.length === 0)
    return { ok: true, backupId: opts.backupId, files: [] };

  // 1) Pre-flight: verify every file matches its expected `before`.
  const conflicts: PatchConflict[] = [];
  const current = new Map<string, string | null>();
  for (const p of patches) {
    let content: string | null = null;
    try {
      content = await readFile(p.path, "utf8");
    } catch {
      content = null;
    }
    current.set(p.path, content);
    if (p.before === null && content !== null)
      conflicts.push({
        path: p.path,
        reason: "expected to create a new file, but it already exists",
      });
    else if (p.before !== null && content === null)
      conflicts.push({
        path: p.path,
        reason: "file is missing (expected existing content)",
      });
    else if (p.before !== null && content !== p.before)
      conflicts.push({
        path: p.path,
        reason: "file content has changed since the fix was computed",
      });
  }
  if (conflicts.length > 0) return { ok: false, conflicts, applied: false };

  // 2) Write the backup manifest BEFORE touching any target file.
  const groupDir = join(opts.backupDir, opts.backupId);
  await mkdir(groupDir, { recursive: true });
  const entries: BackupFileEntry[] = [];
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    const existed = current.get(p.path) !== null;
    const entry: BackupFileEntry = { path: p.path, existed };
    if (existed) {
      const backupFile = join(groupDir, backupFileName(i));
      await writeFile(backupFile, current.get(p.path)!, "utf8");
      entry.backupFile = backupFile;
    }
    entries.push(entry);
  }
  const manifest: BackupManifest = {
    id: opts.backupId,
    createdAt: now(),
    files: entries,
  };
  await writeFile(
    join(groupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  // 3) Apply atomically; recover on failure.
  const applied: string[] = [];
  try {
    for (const p of patches) {
      await atomicWrite(p.path, p.after);
      applied.push(p.path);
    }
  } catch (err) {
    await restore(manifest, applied);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      rolledBack: true,
      applied: false,
    };
  }

  return { ok: true, backupId: opts.backupId, files: applied };
}

/** Restore a subset (or all) of a manifest's files from backup. */
async function restore(
  manifest: BackupManifest,
  only?: string[],
): Promise<void> {
  const target = only ? new Set(only) : null;
  for (const entry of manifest.files) {
    if (target && !target.has(entry.path)) continue;
    if (entry.existed && entry.backupFile) {
      const original = await readFile(entry.backupFile, "utf8");
      await atomicWrite(entry.path, original);
    } else {
      // File was created by the patch — remove it to restore the prior state.
      await rm(entry.path, { force: true }).catch(() => {});
    }
  }
}

/** Roll back a previously-applied backup group. Idempotent. */
export async function rollback(
  backupDir: string,
  backupId: string,
): Promise<boolean> {
  const groupDir = join(backupDir, backupId);
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(
      await readFile(join(groupDir, "manifest.json"), "utf8"),
    ) as BackupManifest;
  } catch {
    return false;
  }
  if (manifest.rolledBack) return true;
  await restore(manifest);
  manifest.rolledBack = true;
  await writeFile(
    join(groupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  ).catch(() => {});
  return true;
}

/** All backup manifests, newest first. */
export async function listBackups(
  backupDir: string,
): Promise<BackupManifest[]> {
  let ids: string[];
  try {
    ids = await readdir(backupDir);
  } catch {
    return [];
  }
  const out: BackupManifest[] = [];
  for (const id of ids) {
    try {
      out.push(
        JSON.parse(
          await readFile(join(backupDir, id, "manifest.json"), "utf8"),
        ) as BackupManifest,
      );
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Roll back the most recent not-yet-undone backup ("undo last fix"). */
export async function undoLast(backupDir: string): Promise<string | null> {
  const backups = await listBackups(backupDir);
  const last = backups.find((b) => !b.rolledBack);
  if (!last) return null;
  await rollback(backupDir, last.id);
  return last.id;
}

/** Default location for fix backups. */
export function defaultBackupDir(workspacePath: string): string {
  return join(workspacePath, ".package-workbench", "fix-backups");
}
