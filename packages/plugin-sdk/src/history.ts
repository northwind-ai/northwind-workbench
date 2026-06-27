/**
 * Historical-run model: compact, persistable snapshots of a Workbench run, plus
 * the delta/regression/CI vocabulary used to compare them over time. Pure types
 * + helpers. Persistence, diffing, and reporting live in
 * `@package-workbench/core`.
 *
 * Snapshots are intentionally small (scores + statuses + failed-check ids, not
 * full reports) so history stays cheap to store and deterministic to diff.
 */

/** Roll-up status of a package (mirrors core's PackageStatus). */
export type SnapshotStatus = "pass" | "warn" | "fail";

/** Provenance for a stored run. */
export interface RunMetadata {
  runId: string;
  /** ISO timestamp. */
  timestamp: string;
  gitBranch?: string;
  gitCommit?: string;
  workspacePath: string;
}

/** Compact per-package outcome. */
export interface PackageSnapshot {
  id: string;
  name: string;
  score: number;
  status: SnapshotStatus;
  /** Ids of checks that failed (used to diff new/resolved failures). */
  failedCheckIds: string[];
  /** Scenario pass rate 0..1, when scenarios ran. */
  scenarioPassRate?: number | null;
}

export interface GraphSnapshot {
  score: number;
  grade: string;
  cycleCount: number;
  violationCount: number;
  smellCount: number;
}

export interface ScenarioSnapshot {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

/** A persisted run: everything needed to compare against a later run. */
export interface HistoricalRun {
  id: string;
  metadata: RunMetadata;
  /** Headline 0..100 health (average package score). */
  overallScore: number;
  summary: {
    totalPackages: number;
    passed: number;
    warned: number;
    failed: number;
    averageScore: number;
  };
  packages: PackageSnapshot[];
  graph?: GraphSnapshot | null;
  scenarios?: ScenarioSnapshot | null;
}

// ---- deltas ------------------------------------------------------------------

export type RegressionSeverity = "critical" | "major" | "minor";

export interface Regression {
  kind: string;
  severity: RegressionSeverity;
  packageId?: string;
  detail: string;
}

export interface Improvement {
  kind: string;
  packageId?: string;
  detail: string;
}

/** A deterministic comparison of two runs (previous → current). */
export interface RunDelta {
  previousId: string;
  currentId: string;
  scoreDelta: number;
  regressions: Regression[];
  improvements: Improvement[];
  graphDelta?: {
    scoreDelta: number;
    newCycles: number;
    newViolations: number;
  } | null;
  scenarioDelta?: { passRateDelta: number; newFailures: number } | null;
  /** One-line human summary. */
  summary: string;
}

// ---- CI ----------------------------------------------------------------------

/** Thresholds that make CI fail. All optional; omitted checks are not enforced. */
export interface CiPolicy {
  /** Fail if the score drops by more than this many points. */
  maxScoreDrop?: number;
  /** Fail if the absolute score is below this. */
  minScore?: number;
  failOnCritical?: boolean;
  failOnNewCycle?: boolean;
  failOnNewViolation?: boolean;
  failOnScenarioRegression?: boolean;
}

export interface CiViolation {
  rule: string;
  detail: string;
}

export interface CiResult {
  passed: boolean;
  score: number;
  scoreDelta: number;
  violations: CiViolation[];
  regressionCount: number;
  /** True when there was no baseline to compare against. */
  baselineMissing: boolean;
}

/** Sensible default CI policy. */
export const DEFAULT_CI_POLICY: CiPolicy = {
  maxScoreDrop: 5,
  failOnCritical: true,
  failOnNewCycle: true,
  failOnNewViolation: true,
  failOnScenarioRegression: true,
};

// ---- notifications -----------------------------------------------------------

export type NotificationLevel = "info" | "warning" | "critical";

export interface WorkbenchNotification {
  level: NotificationLevel;
  title: string;
  body: string;
}

// ---- pure helpers ------------------------------------------------------------

/** Rank for sorting regressions worst-first. */
export const regressionRank: Record<RegressionSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};
