import type { RunDelta } from "@package-workbench/plugin-sdk";
import type {
  BlastRadius,
  ChangedPackage,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
} from "./types";

/**
 * Deterministic PR risk scoring. Combines five independent signals into a 0..100
 * score and a {@link RiskLevel}, with every contributing factor itemised so the
 * verdict is explainable (not a black box):
 *
 *  1. health regressions  — new check failures, weighted by severity
 *  2. graph changes       — new cycles / boundary violations
 *  3. scenario regressions— behaviour that stopped passing
 *  4. score drop          — magnitude of the overall health move
 *  5. blast radius         — how much of the workspace the change can affect,
 *                            amplified by the centrality of what was touched
 *
 * Same inputs → same score, always.
 */

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

function levelFor(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

export interface RiskInput {
  delta: RunDelta;
  blastRadius: BlastRadius;
  changed: ChangedPackage[];
}

export function assessRisk({
  delta,
  blastRadius,
  changed,
}: RiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];

  // 1) Health regressions, weighted by severity.
  const counts = { critical: 0, major: 0, minor: 0 };
  for (const r of delta.regressions) counts[r.severity]++;
  const regressionPoints =
    counts.critical * 25 + counts.major * 12 + counts.minor * 4;
  if (regressionPoints > 0) {
    factors.push({
      label: "Health regressions",
      points: regressionPoints,
      detail: `${counts.critical} critical, ${counts.major} major, ${counts.minor} minor`,
    });
  }

  // 2) Graph changes.
  if (delta.graphDelta) {
    if (delta.graphDelta.newCycles > 0)
      factors.push({
        label: "New dependency cycle(s)",
        points: 20 * delta.graphDelta.newCycles,
        detail: `${delta.graphDelta.newCycles} introduced`,
      });
    if (delta.graphDelta.newViolations > 0)
      factors.push({
        label: "New boundary violation(s)",
        points: 10 * delta.graphDelta.newViolations,
        detail: `${delta.graphDelta.newViolations} introduced`,
      });
  }

  // 3) Scenario regressions.
  if (delta.scenarioDelta && delta.scenarioDelta.newFailures > 0) {
    factors.push({
      label: "Scenario regressions",
      points: 15 * delta.scenarioDelta.newFailures,
      detail: `${delta.scenarioDelta.newFailures} new scenario failure(s)`,
    });
  }

  // 4) Score drop magnitude.
  const drop = -delta.scoreDelta;
  if (drop > 0)
    factors.push({
      label: "Health score drop",
      points: clamp(drop * 1.5, 0, 30),
      detail: `−${drop} points`,
    });

  // 5) Blast radius, amplified by the centrality of edited packages.
  const editedCentrality = changed
    .filter((c) => c.reason === "edited")
    .reduce((m, c) => Math.max(m, c.centrality), 0);
  const radiusPoints = clamp(
    blastRadius.coverage * 40 + editedCentrality * 25,
    0,
    45,
  );
  if (blastRadius.total.length > 0) {
    factors.push({
      label: "Blast radius",
      points: radiusPoints,
      detail: `${blastRadius.edited.length} edited → ${blastRadius.impacted.length} impacted (${Math.round(blastRadius.coverage * 100)}% of workspace)`,
    });
  }

  const score = Math.round(
    clamp(
      factors.reduce((s, f) => s + f.points, 0),
      0,
      100,
    ),
  );
  factors.sort((a, b) => b.points - a.points);
  return { level: levelFor(score), score, factors };
}
