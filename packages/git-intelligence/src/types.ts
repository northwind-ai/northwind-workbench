import type { BlastRadius } from "@package-workbench/core";

/**
 * Git Diff Intelligence — analyze only what changed and compute its blast radius,
 * instead of scanning the whole repo. Pure types only.
 *
 * It reuses the existing dependency-graph + blast-radius engines (no new graph
 * logic) and adds the git layer, risk scoring, regression prediction, and a
 * targeted scan plan on top.
 */

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  /** Workspace-relative path (the new path for renames). */
  path: string;
  status: ChangeStatus;
  /** Previous path, for renames. */
  oldPath?: string;
}

export type DiffMode = "working" | "staged" | "range";

/** What to compare. `range` covers branch↔branch and commit↔commit. */
export interface DiffSpec {
  mode: DiffMode;
  /** For `range`: base and optional head (defaults to working tree / HEAD). */
  base?: string;
  head?: string;
}

export type DiffRiskLevel = "low" | "medium" | "high" | "critical";

export interface ChangedPackageInfo {
  id: string;
  name: string;
  /** `edited` = files changed directly; `dependency` = impacted transitively. */
  reason: "edited" | "dependency";
  changedFiles: string[];
  centrality: number;
  /** Transitive dependents (how far a change ripples). */
  dependents: number;
}

export interface RegressionPrediction {
  kind: string;
  detail: string;
  likelihood: "low" | "medium" | "high";
  /** Packages most exposed to this predicted regression. */
  packages: string[];
}

export interface ScanPlanItem {
  packageId: string;
  /** The checks worth running for this package (a subset, not the full suite). */
  checks: string[];
  reason: string;
}

export interface DiffRiskFactor {
  label: string;
  points: number;
  detail: string;
}

export interface DiffRisk {
  level: DiffRiskLevel;
  /** 0..100. */
  score: number;
  factors: DiffRiskFactor[];
  /** One-line headline reason, e.g. "core has 31 dependents". */
  reason: string;
}

/** The complete diff-intelligence report. */
export interface DiffReport {
  spec: DiffSpec;
  changedFiles: ChangedFile[];
  changedPackages: ChangedPackageInfo[];
  blastRadius: BlastRadius;
  /** Packages whose package.json was deleted (no longer in the workspace). */
  deletedPackages: string[];
  risk: DiffRisk;
  predictedRegressions: RegressionPrediction[];
  /** A targeted scan plan — only what needs re-checking. */
  scanPlan: ScanPlanItem[];
  /** Fraction of the workspace that can be skipped vs a full scan, 0..1. */
  scanSavings: number;
  generatedAt: string;
}
