/**
 * Auto Fix engine — safely apply certain fixes automatically. Conservative and
 * safe by construction:
 *
 *  - A strict safety taxonomy (`safe` / `review_required` / `dangerous`); only
 *    `safe` fixes auto-apply, `dangerous` ones are never applied.
 *  - An atomic patch engine: pre-flight conflict checks, backups written before
 *    any change, temp-file + rename writes, and all-or-nothing recovery — a file
 *    is never left half-written or corrupted.
 *  - Full rollback: undo the last fix, roll back a session, restore from backup.
 */
export * from "./types";
export { detectFixes, type DetectFixesInput } from "./detectors";
export {
  buildFixPlan,
  applyFix,
  applyFixPlan,
  rollback,
  undoLast,
  listBackups,
  defaultBackupDir,
  type ApplyFixOptions,
  type ApplyPlanOptions,
} from "./plan";
export {
  applyPatches,
  atomicWrite,
  type ApplyOutcome,
  type BackupManifest,
} from "./patch";
export { diffLines, renderPatchDiff, type DiffLine } from "./diff";
export { renderFixText, renderFixMarkdown } from "./render";
