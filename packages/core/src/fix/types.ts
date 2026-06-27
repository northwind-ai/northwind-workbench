/**
 * The Auto Fix engine model. Package Workbench can *safely* apply certain fixes
 * automatically — and only those. The taxonomy is the safety contract:
 *
 *   safe            → may auto-apply (deterministic, reversible, low blast radius)
 *   review_required → suggested with a diff; needs explicit confirmation
 *   dangerous       → never applied; only described (refactors, code rewrites)
 *
 * Pure types only. The patch engine (atomic writes, backups, rollback) and the
 * detectors live alongside in `@package-workbench/core`.
 */

export type FixSafetyLevel = "safe" | "review_required" | "dangerous";

/** What the fix touches — drives grouping + which engine produces the patch. */
export type FixActionKind =
  // dependency
  | "add_missing_dependency"
  | "add_missing_peer_dependency"
  | "remove_unused_dependency"
  // package.json
  | "add_missing_main"
  | "add_missing_types"
  | "add_missing_exports"
  // imports
  | "fix_broken_import_path"
  | "fix_stale_reexport"
  // metadata
  | "add_missing_script"
  | "add_missing_field"
  // review-required
  | "rewrite_exports_map"
  | "resolve_duplicate_version"
  | "fix_path_alias"
  // dangerous (suggest-only)
  | "architecture_refactor";

/** A single file edit: the exact before/after content. `before: null` = create. */
export interface FixPatch {
  /** Absolute file path. */
  path: string;
  /** Expected current content (null when the file should not yet exist). */
  before: string | null;
  /** New content to write. */
  after: string;
}

/** A proposed fix: what, why, how safe, and the patch(es) it would apply. */
export interface FixCandidate {
  id: string;
  kind: FixActionKind;
  safety: FixSafetyLevel;
  /** Short title, e.g. "Add dependency to package.json". */
  title: string;
  /** What problem this addresses, e.g. "Missing dependency: zod". */
  problem: string;
  /** One-line description of the change. */
  description: string;
  /** Packages affected. */
  packageId?: string;
  /** The concrete file edits. Empty for suggest-only (dangerous) candidates. */
  patches: FixPatch[];
  /** Evidence backing the fix. */
  evidence: string[];
}

/** A set of candidates for a workspace, partitioned by safety. */
export interface FixPlan {
  candidates: FixCandidate[];
  summary: {
    safe: number;
    reviewRequired: number;
    dangerous: number;
  };
  generatedAt: string;
}

/** Outcome of applying one candidate. */
export interface FixResult {
  candidateId: string;
  applied: boolean;
  /** Files written (absolute paths). */
  files: string[];
  /** The backup id for rollback, when applied. */
  backupId?: string;
  /** Why it was skipped / failed, when not applied. */
  reason?: string;
}

/** Result of applying a plan (a session of fixes). */
export interface ApplySessionResult {
  results: FixResult[];
  appliedCount: number;
  /** Session id — undo the whole session with this. */
  sessionId: string;
}
