import type {
  HealthCheckResult,
  PackageInfo,
  WorkspaceInfo,
} from '@package-workbench/plugin-sdk';

/** How much we trust a package's score, given how many checks were conclusive. */
export type Confidence = 'low' | 'medium' | 'high';

/** Overall roll-up status for a package. */
export type PackageStatus = 'pass' | 'warn' | 'fail';

/** The aggregate health outcome for one package. */
export interface PackageHealthReport {
  package: PackageInfo;
  checks: HealthCheckResult[];
  /** 0..100 deterministic health score. */
  score: number;
  confidence: Confidence;
  status: PackageStatus;
  generatedAt: string;
}

/** A full Workbench run across an entire workspace. */
export interface WorkbenchRun {
  id: string;
  workspace: WorkspaceInfo;
  reports: PackageHealthReport[];
  summary: WorkbenchRunSummary;
  startedAt: string;
  finishedAt: string;
}

/** Aggregate counts for a run, for dashboards and CI gates. */
export interface WorkbenchRunSummary {
  totalPackages: number;
  passed: number;
  warned: number;
  failed: number;
  /** Mean of all package scores, 0..100. */
  averageScore: number;
  /** Packages whose confidence is `low`. */
  lowConfidence: number;
  /** Id of the lowest-scoring package, if any. */
  worstPackageId: string | null;
}

/** Progress events emitted by a runner. CLI prints them; the UI streams them. */
export type RunnerEvent =
  | { type: 'run:start'; cwd: string }
  | { type: 'workspace:detected'; workspace: WorkspaceInfo }
  | { type: 'package:start'; packageId: string }
  | { type: 'check:start'; packageId: string; checkId: string }
  | { type: 'check:done'; packageId: string; result: HealthCheckResult }
  | { type: 'package:done'; report: PackageHealthReport }
  | { type: 'run:done'; run: WorkbenchRun };
