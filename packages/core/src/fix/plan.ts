import {
  applyPatches,
  defaultBackupDir,
  rollback,
  undoLast,
  listBackups,
} from "./patch";
import type {
  ApplySessionResult,
  FixCandidate,
  FixPlan,
  FixResult,
} from "./types";

/**
 * The Auto Fix orchestrator. Builds a {@link FixPlan} from candidates and applies
 * the selected ones through the atomic patch engine — gated by safety so that
 * **only `safe` fixes auto-apply** unless the caller explicitly opts into
 * `review_required`. `dangerous` candidates are never applied.
 *
 * Each candidate gets its own backup group, so "undo last fix" and per-fix
 * rollback both work; a whole session can be undone in reverse order.
 */

export function buildFixPlan(
  candidates: FixCandidate[],
  now: () => string = () => new Date().toISOString(),
): FixPlan {
  const summary = { safe: 0, reviewRequired: 0, dangerous: 0 };
  for (const c of candidates) {
    if (c.safety === "safe") summary.safe++;
    else if (c.safety === "review_required") summary.reviewRequired++;
    else summary.dangerous++;
  }
  // Stable order: safe first, then review, then dangerous; deterministic within.
  const order = { safe: 0, review_required: 1, dangerous: 2 } as const;
  const sorted = [...candidates].sort(
    (a, b) => order[a.safety] - order[b.safety] || a.id.localeCompare(b.id),
  );
  return { candidates: sorted, summary, generatedAt: now() };
}

export interface ApplyFixOptions {
  backupDir: string;
  backupId: string;
  /** Allow applying a `review_required` fix (still never `dangerous`). */
  allowReview?: boolean;
  now?: () => string;
}

/** Apply a single candidate. Refuses dangerous fixes and (by default) review-required. */
export async function applyFix(
  candidate: FixCandidate,
  opts: ApplyFixOptions,
): Promise<FixResult> {
  if (candidate.safety === "dangerous") {
    return {
      candidateId: candidate.id,
      applied: false,
      files: [],
      reason: "dangerous fixes are never auto-applied",
    };
  }
  if (candidate.safety === "review_required" && !opts.allowReview) {
    return {
      candidateId: candidate.id,
      applied: false,
      files: [],
      reason: "review required — confirm before applying",
    };
  }
  if (candidate.patches.length === 0) {
    return {
      candidateId: candidate.id,
      applied: false,
      files: [],
      reason: "no patch to apply (suggest-only)",
    };
  }

  const outcome = await applyPatches(candidate.patches, {
    backupDir: opts.backupDir,
    backupId: opts.backupId,
    now: opts.now,
  });
  if (outcome.ok) {
    return {
      candidateId: candidate.id,
      applied: true,
      files: outcome.files,
      backupId: outcome.backupId,
    };
  }
  const reason =
    "conflicts" in outcome
      ? `conflict: ${outcome.conflicts.map((c) => c.reason).join("; ")}`
      : `failed (${outcome.error})${outcome.rolledBack ? " — rolled back" : ""}`;
  return { candidateId: candidate.id, applied: false, files: [], reason };
}

export interface ApplyPlanOptions {
  /** Where backups go. Defaults to `<workspace>/.package-workbench/fix-backups`. */
  backupDir?: string;
  workspaceRoot?: string;
  /** 'safe' (default) or 'safe+review'. Dangerous is never applied. */
  level?: "safe" | "safe+review";
  /** Restrict to these candidate ids (otherwise all eligible by `level`). */
  only?: string[];
  /** Stable session id (injectable for tests). */
  sessionId: string;
  now?: () => string;
}

/** Apply all eligible candidates in a plan. Returns the session result. */
export async function applyFixPlan(
  plan: FixPlan,
  opts: ApplyPlanOptions,
): Promise<ApplySessionResult> {
  const backupDir =
    opts.backupDir ??
    (opts.workspaceRoot
      ? defaultBackupDir(opts.workspaceRoot)
      : ".package-workbench/fix-backups");
  const allowReview = opts.level === "safe+review";
  const onlySet = opts.only ? new Set(opts.only) : null;

  const results: FixResult[] = [];
  let i = 0;
  for (const c of plan.candidates) {
    if (onlySet && !onlySet.has(c.id)) continue;
    if (c.safety === "dangerous") continue;
    if (c.safety === "review_required" && !allowReview) continue;
    const result = await applyFix(c, {
      backupDir,
      backupId: `${opts.sessionId}-${i++}`,
      allowReview,
      now: opts.now,
    });
    results.push(result);
  }
  return {
    results,
    appliedCount: results.filter((r) => r.applied).length,
    sessionId: opts.sessionId,
  };
}

export { rollback, undoLast, listBackups, defaultBackupDir };
