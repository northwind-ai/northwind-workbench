import type {
  GraphSnapshot,
  HistoricalRun,
  PackageSnapshot,
  ScenarioSnapshot,
} from "@package-workbench/plugin-sdk";
import type { WorkbenchRun } from "../types";
import { readGitInfo, type GitInfo } from "./git";

/**
 * Distils a full {@link WorkbenchRun} into a compact, persistable
 * {@link HistoricalRun} snapshot — scores, statuses, failed-check ids, and graph/
 * scenario summaries. Deterministic given the run + provided metadata.
 */

export interface SnapshotOptions {
  workspacePath: string;
  runId: string;
  timestamp: string;
  git?: GitInfo;
}

export function buildSnapshot(
  run: WorkbenchRun,
  opts: SnapshotOptions,
): HistoricalRun {
  const packages: PackageSnapshot[] = run.reports.map((r) => ({
    id: r.package.id,
    name: r.package.name,
    score: r.score,
    status: r.status,
    failedCheckIds: r.checks
      .filter((c) => c.status === "fail")
      .map((c) => c.checkId),
    scenarioPassRate: r.scenarios ? r.scenarios.passRate : null,
  }));

  const graph: GraphSnapshot | null = run.graph
    ? {
        score: run.graph.health.score,
        grade: run.graph.health.grade,
        cycleCount: run.graph.cycles.length,
        violationCount: run.graph.violations.length,
        smellCount: run.graph.smells.length,
      }
    : null;

  // Aggregate scenario results across packages.
  const scenarioRuns = run.reports
    .map((r) => r.scenarios)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  let scenarios: ScenarioSnapshot | null = null;
  if (scenarioRuns.length > 0) {
    const total = scenarioRuns.reduce((n, s) => n + s.total, 0);
    const passed = scenarioRuns.reduce((n, s) => n + s.passed, 0);
    const failed = scenarioRuns.reduce((n, s) => n + s.failed, 0);
    scenarios = {
      total,
      passed,
      failed,
      passRate: total === 0 ? 1 : passed / total,
    };
  }

  return {
    id: opts.runId,
    metadata: {
      runId: opts.runId,
      timestamp: opts.timestamp,
      gitBranch: opts.git?.branch,
      gitCommit: opts.git?.commit,
      workspacePath: opts.workspacePath,
    },
    overallScore: run.summary.averageScore,
    summary: {
      totalPackages: run.summary.totalPackages,
      passed: run.summary.passed,
      warned: run.summary.warned,
      failed: run.summary.failed,
      averageScore: run.summary.averageScore,
    },
    packages,
    graph,
    scenarios,
  };
}

/** Convenience: read git info for a workspace then build the snapshot. */
export async function snapshotRun(
  run: WorkbenchRun,
  opts: Omit<SnapshotOptions, "git">,
): Promise<HistoricalRun> {
  const git = await readGitInfo(opts.workspacePath);
  return buildSnapshot(run, { ...opts, git });
}
