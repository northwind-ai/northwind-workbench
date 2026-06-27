import type {
  HistoricalRun,
  Improvement,
  PackageSnapshot,
  Regression,
  RegressionSeverity,
  RunDelta,
} from "@package-workbench/plugin-sdk";
import { regressionRank } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

/**
 * The delta engine: a deterministic comparison of two run snapshots. Detects
 * score moves, new/resolved check failures (classified critical/major/minor),
 * and graph + scenario regressions. Same inputs → same output, always.
 */

/** Checks whose failure makes a package effectively unusable. */
const CRITICAL_CHECKS = new Set<string>([
  CheckId.runtimeImport,
  CheckId.packageJsonValid,
  CheckId.entrypointExists,
  CheckId.mainModuleExists,
  CheckId.moduleResolution,
]);
/** Checks whose failure is serious but not fatal. */
const MAJOR_CHECKS = new Set<string>([
  CheckId.exportsMap,
  CheckId.scenarioRunner,
  CheckId.browserCompatibility,
  CheckId.missingPeerDependencies,
]);

function checkSeverity(checkId: string): RegressionSeverity {
  if (CRITICAL_CHECKS.has(checkId)) return "critical";
  if (MAJOR_CHECKS.has(checkId)) return "major";
  return "minor";
}

/** True if any package in the run currently has a fatal (critical) check failure. */
export function hasCriticalFailure(run: HistoricalRun): boolean {
  return run.packages.some((p) =>
    p.failedCheckIds.some((id) => CRITICAL_CHECKS.has(id)),
  );
}

const byId = (pkgs: PackageSnapshot[]): Map<string, PackageSnapshot> =>
  new Map(pkgs.map((p) => [p.id, p]));

export function compareRuns(
  previous: HistoricalRun,
  current: HistoricalRun,
): RunDelta {
  const prevPkgs = byId(previous.packages);
  const regressions: Regression[] = [];
  const improvements: Improvement[] = [];

  for (const cur of current.packages) {
    const prev = prevPkgs.get(cur.id);
    if (!prev) {
      if (cur.status === "fail") {
        regressions.push({
          kind: "new_failing_package",
          severity: "major",
          packageId: cur.id,
          detail: `New package ${cur.name} is failing`,
        });
      }
      continue;
    }

    const prevFailed = new Set(prev.failedCheckIds);
    const curFailed = new Set(cur.failedCheckIds);

    for (const checkId of curFailed) {
      if (!prevFailed.has(checkId)) {
        regressions.push({
          kind: `check:${checkId}`,
          severity: checkSeverity(checkId),
          packageId: cur.id,
          detail: `${cur.name}: ${humanCheck(checkId)} now fails`,
        });
      }
    }
    for (const checkId of prevFailed) {
      if (!curFailed.has(checkId)) {
        improvements.push({
          kind: `check:${checkId}`,
          packageId: cur.id,
          detail: `${cur.name}: ${humanCheck(checkId)} resolved`,
        });
      }
    }

    const drop = prev.score - cur.score;
    if (drop >= 15 && curFailed.size === prevFailed.size) {
      regressions.push({
        kind: "score_drop",
        severity: "minor",
        packageId: cur.id,
        detail: `${cur.name} score dropped ${drop} (${prev.score} → ${cur.score})`,
      });
    } else if (cur.score - prev.score >= 15) {
      improvements.push({
        kind: "score_gain",
        packageId: cur.id,
        detail: `${cur.name} score rose ${cur.score - prev.score}`,
      });
    }
  }

  // Graph delta.
  let graphDelta: RunDelta["graphDelta"] = null;
  if (previous.graph && current.graph) {
    const newCycles = Math.max(
      0,
      current.graph.cycleCount - previous.graph.cycleCount,
    );
    const newViolations = Math.max(
      0,
      current.graph.violationCount - previous.graph.violationCount,
    );
    graphDelta = {
      scoreDelta: current.graph.score - previous.graph.score,
      newCycles,
      newViolations,
    };
    if (newCycles > 0)
      regressions.push({
        kind: "new_cycle",
        severity: "major",
        detail: `${newCycles} new circular dependency(ies)`,
      });
    if (newViolations > 0)
      regressions.push({
        kind: "new_violation",
        severity: "major",
        detail: `${newViolations} new boundary violation(s)`,
      });
    if (previous.graph.cycleCount > current.graph.cycleCount)
      improvements.push({
        kind: "cycle_removed",
        detail: `${previous.graph.cycleCount - current.graph.cycleCount} cycle(s) removed`,
      });
  }

  // Scenario delta.
  let scenarioDelta: RunDelta["scenarioDelta"] = null;
  if (previous.scenarios && current.scenarios) {
    const passRateDelta =
      current.scenarios.passRate - previous.scenarios.passRate;
    const newFailures = Math.max(
      0,
      current.scenarios.failed - previous.scenarios.failed,
    );
    scenarioDelta = { passRateDelta, newFailures };
    if (newFailures > 0)
      regressions.push({
        kind: "scenario_regression",
        severity: "major",
        detail: `${newFailures} new scenario failure(s)`,
      });
  }

  regressions.sort(
    (a, b) => regressionRank[a.severity] - regressionRank[b.severity],
  );

  const scoreDelta = current.overallScore - previous.overallScore;
  const counts = tally(regressions);
  const summary =
    `Score ${previous.overallScore} → ${current.overallScore} (${scoreDelta >= 0 ? "+" : ""}${scoreDelta})` +
    (regressions.length
      ? ` · ${counts.critical} critical, ${counts.major} major, ${counts.minor} minor regression(s)`
      : " · no regressions");

  return {
    previousId: previous.id,
    currentId: current.id,
    scoreDelta,
    regressions,
    improvements,
    graphDelta,
    scenarioDelta,
    summary,
  };
}

export function tally(
  regressions: Regression[],
): Record<RegressionSeverity, number> {
  const counts: Record<RegressionSeverity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
  };
  for (const r of regressions) counts[r.severity]++;
  return counts;
}

function humanCheck(checkId: string): string {
  return checkId
    .replace(/_/g, " ")
    .replace(/\bcheck\b/, "")
    .trim();
}
