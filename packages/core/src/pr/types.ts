import type { RunDelta } from "@package-workbench/plugin-sdk";

/**
 * The PR-analysis vocabulary: comparing a PR branch against its base to catch
 * package regressions before merge. Pure types only — the engine (blast radius,
 * risk scoring, policy, reporting) lives alongside in `@package-workbench/core`
 * and produces values conforming to this contract; the desktop renders them.
 *
 * It builds on the existing delta engine ({@link RunDelta}) rather than
 * re-deriving regressions: a PR review is "a delta, plus who-is-impacted, plus a
 * risk verdict, plus a merge recommendation".
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Why a package is considered impacted by the PR. */
export type ChangeReason = "edited" | "dependency";

/** A package the PR touches — directly (edited files) or transitively. */
export interface ChangedPackage {
  id: string;
  name: string;
  reason: ChangeReason;
  /** Workspace-relative files attributed to this package (for `edited`). */
  changedFiles: string[];
  /** Degree centrality 0..1 from the graph — how central this package is. */
  centrality: number;
  /** Count of packages that transitively depend on this one. */
  dependents: number;
}

/**
 * Dependency-aware impact: not just the edited packages, but everything that
 * transitively depends on them. "core changed → 23 dependent packages impacted."
 */
export interface BlastRadius {
  /** Packages with direct file edits. */
  edited: string[];
  /** Packages transitively impacted (dependents of edited), excluding edited. */
  impacted: string[];
  /** edited ∪ impacted, deduped. */
  total: string[];
  /** Per-edited-package fan-out of impact (sorted widest first). */
  byPackage: Array<{ id: string; impacted: string[] }>;
  /** Fraction of the workspace impacted, 0..1. */
  coverage: number;
}

export interface RiskFactor {
  label: string;
  /** Points this factor contributed to the risk score. */
  points: number;
  detail: string;
}

/** The PR's overall risk, with the factors behind it. */
export interface RiskAssessment {
  level: RiskLevel;
  /** 0..100, higher = riskier. */
  score: number;
  factors: RiskFactor[];
}

export type MergeRecommendation = "approve" | "warn" | "block";

/**
 * Merge gate configuration. All optional; omitted rules are not enforced.
 * Loaded from `workbench.policy.ts` (or `package.json#packageWorkbench.policy`),
 * merged over {@link DEFAULT_MERGE_POLICY}.
 */
export interface MergePolicy {
  /** Block when the overall health score drops by more than this. */
  maxScoreDrop?: number;
  /** Block when any package has a critical (unusable) failure. */
  blockOnCriticalFailure?: boolean;
  /** Block when the PR introduces a new dependency cycle. */
  blockOnNewCycle?: boolean;
  /** Block when the PR introduces a new boundary violation. */
  blockOnNewViolation?: boolean;
  /** Block when scenario pass-rate regresses. */
  blockOnScenarioRegression?: boolean;
  /** Block when computed risk is at/above this level. */
  blockAtRisk?: RiskLevel;
  /** Warn (rather than block) on any other regression. */
  warnOnRegression?: boolean;
}

/** The merge gate's verdict. */
export interface MergeDecision {
  recommendation: MergeRecommendation;
  /** Human reasons, worst-first. */
  reasons: string[];
  /** Rules that fired a block. */
  blockedBy: string[];
}

/** A reference point in the comparison (base or head). */
export interface PrRef {
  /** Branch / ref name or commit, when known. */
  ref?: string;
  score: number;
}

/** The complete PR review — the value rendered into a comment + status check. */
export interface PrReview {
  base: PrRef;
  head: PrRef;
  scoreDelta: number;
  /** Packages the PR touches (edited + dependency-impacted). */
  changed: ChangedPackage[];
  blastRadius: BlastRadius;
  /** The regression delta from the existing delta engine. */
  delta: RunDelta;
  risk: RiskAssessment;
  decision: MergeDecision;
  generatedAt: string;
}

export const RISK_RANK: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Sensible default merge policy — blocks on the things that break consumers. */
export const DEFAULT_MERGE_POLICY: MergePolicy = {
  maxScoreDrop: 10,
  blockOnCriticalFailure: true,
  blockOnNewCycle: true,
  blockOnNewViolation: false,
  blockOnScenarioRegression: true,
  blockAtRisk: "critical",
  warnOnRegression: true,
};
