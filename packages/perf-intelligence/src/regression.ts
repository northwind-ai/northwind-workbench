import type {
  PerformanceRegression,
  PerformanceSnapshot,
  PerfRegressionKind,
} from "./types";

/**
 * Compare two performance snapshots and report regressions: slower builds,
 * growing bundles, memory growth, slower scenarios. Deterministic; thresholds
 * keep noise down (small movements are not flagged).
 */

const THRESHOLDS: Record<PerfRegressionKind, number> = {
  build: 20,
  bundle: 15,
  memory: 25,
  scenario: 20,
  check: 25,
};

function severity(pct: number): PerformanceRegression["severity"] {
  if (pct >= 50) return "critical";
  if (pct >= 25) return "major";
  return "minor";
}

function pct(before: number, after: number): number {
  if (before <= 0) return after > 0 ? 100 : 0;
  return Math.round(((after - before) / before) * 100);
}

export function compareSnapshots(
  prev: PerformanceSnapshot,
  curr: PerformanceSnapshot,
): PerformanceRegression[] {
  const out: PerformanceRegression[] = [];
  const prevById = new Map(prev.packages.map((p) => [p.id, p]));

  for (const cur of curr.packages) {
    const before = prevById.get(cur.id);
    if (!before) continue;

    const buildBefore = before.build.durationMs ?? before.build.estimatedWeight;
    const buildAfter = cur.build.durationMs ?? cur.build.estimatedWeight;
    pushIf(out, "build", cur.id, `${cur.name} build`, buildBefore, buildAfter);
    pushIf(
      out,
      "bundle",
      cur.id,
      `${cur.name} bundle`,
      before.bundleBytes,
      cur.bundleBytes,
    );
    pushIf(
      out,
      "memory",
      cur.id,
      `${cur.name} peak memory`,
      before.memory.peakBytes,
      cur.memory.peakBytes,
    );
    pushIf(
      out,
      "scenario",
      cur.id,
      `${cur.name} scenarios`,
      before.scenarioMs,
      cur.scenarioMs,
    );
  }

  // Workspace-wide check time.
  pushIf(
    out,
    "check",
    undefined,
    "Total health-check time",
    prev.totals.checkMs,
    curr.totals.checkMs,
  );

  return out.sort((a, b) => b.pctChange - a.pctChange);
}

function pushIf(
  out: PerformanceRegression[],
  kind: PerfRegressionKind,
  packageId: string | undefined,
  subject: string,
  before: number,
  after: number,
): void {
  const change = pct(before, after);
  if (change < THRESHOLDS[kind]) return;
  if (before === 0 && after === 0) return;
  out.push({
    kind,
    packageId,
    detail: `${subject} ${change >= 0 ? "+" : ""}${change}%`,
    before,
    after,
    pctChange: change,
    severity: severity(change),
  });
}
