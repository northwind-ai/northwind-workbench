import type {
  HealthCheckResult,
  HealthCheckSeverity,
  PackageInfo,
} from "@package-workbench/plugin-sdk";
import type { Confidence, PackageHealthReport, PackageStatus } from "./types";

/**
 * Deterministic health scoring. No randomness, no time dependence — the same
 * checks always produce the same score, so it's safe to assert in tests and
 * diff across runs.
 *
 * Model: start at 100 and subtract penalties.
 *  - Failing checks subtract heavily, scaled by severity (critical hurts most).
 *  - Warnings subtract moderately (roughly half of the equivalent failure).
 *  - pass / skip / unknown subtract nothing from the score.
 *
 * Skipped and unknown checks instead erode *confidence*: a 100 made of mostly
 * skipped checks is not the same as a 100 where everything actually ran.
 */

const FAIL_PENALTY: Record<HealthCheckSeverity, number> = {
  critical: 50,
  high: 30,
  medium: 15,
  low: 7,
  info: 2,
};

const WARN_PENALTY: Record<HealthCheckSeverity, number> = {
  critical: 20,
  high: 12,
  medium: 8,
  low: 4,
  info: 1,
};

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, n));

export function computeScore(checks: HealthCheckResult[]): number {
  let penalty = 0;
  for (const c of checks) {
    if (c.status === "fail") penalty += FAIL_PENALTY[c.severity];
    else if (c.status === "warn") penalty += WARN_PENALTY[c.severity];
  }
  return clamp(Math.round(100 - penalty));
}

export function computeConfidence(checks: HealthCheckResult[]): Confidence {
  if (checks.length === 0) return "low";

  const conclusive = checks.filter(
    (c) => c.status === "pass" || c.status === "fail" || c.status === "warn",
  ).length;
  const ratio = conclusive / checks.length;
  const hasUnknown = checks.some((c) => c.status === "unknown");

  let confidence: Confidence =
    ratio >= 0.75 ? "high" : ratio >= 0.45 ? "medium" : "low";

  // `unknown` (couldn't determine) is worse than `skip` (deliberately N/A):
  // never report high confidence while a check failed to resolve at all.
  if (hasUnknown && confidence === "high") confidence = "medium";

  return confidence;
}

export function computeStatus(checks: HealthCheckResult[]): PackageStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

/** Build a full report for one package from its check results. */
export function buildReport(
  pkg: PackageInfo,
  checks: HealthCheckResult[],
  generatedAt: string,
): PackageHealthReport {
  return {
    package: pkg,
    checks,
    score: computeScore(checks),
    confidence: computeConfidence(checks),
    status: computeStatus(checks),
    generatedAt,
  };
}

/** Aggregate a set of package reports into a run summary. */
export function summarize(
  reports: PackageHealthReport[],
): import("./types").WorkbenchRunSummary {
  const total = reports.length;
  const passed = reports.filter((r) => r.status === "pass").length;
  const warned = reports.filter((r) => r.status === "warn").length;
  const failed = reports.filter((r) => r.status === "fail").length;
  const lowConfidence = reports.filter((r) => r.confidence === "low").length;
  const averageScore =
    total === 0
      ? 0
      : Math.round(reports.reduce((s, r) => s + r.score, 0) / total);

  let worstPackageId: string | null = null;
  let worstScore = Infinity;
  for (const r of reports) {
    if (r.score < worstScore) {
      worstScore = r.score;
      worstPackageId = r.package.id;
    }
  }

  return {
    totalPackages: total,
    passed,
    warned,
    failed,
    averageScore,
    lowConfidence,
    worstPackageId,
  };
}
