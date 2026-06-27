import type { ActivityStatus, CoverageLevel, DebtFinding } from "./types";

/**
 * Technical-debt detection. Source-marker scanning (TODO/FIXME/HACK/XXX),
 * incomplete-feature signals ("Not implemented", stubs, placeholders), and
 * conservative mock/demo leakage in non-test code. Plus the pure activity,
 * coverage, and debt-scoring helpers. All deterministic; tuned to avoid false
 * positives.
 */

export interface SourceLike {
  rel: string;
  content: string;
  isTest: boolean;
}

const MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b[:\s]?(.*)/g;
const NOT_IMPLEMENTED_RE =
  /throw\s+new\s+\w*Error\s*\(\s*['"`][^'"`]*\b(not\s*implemented|unimplemented|todo)\b/i;
const STUB_RE = /\b(stub|placeholder|not\s*yet\s*implemented)\b/i;
const MOCK_LEAK_RE =
  /\b(mockData|fakeData|dummyData|fakeResponse|hardcoded|FIXME:\s*remove|__mocks__)\b/;

const MARKER_KIND = {
  TODO: "todo",
  FIXME: "fixme",
  HACK: "hack",
  XXX: "xxx",
} as const;
const MARKER_SEVERITY = {
  TODO: "low",
  FIXME: "medium",
  HACK: "medium",
  XXX: "low",
} as const;

/** Scan a package's source files for debt markers + incomplete-feature signals. */
export function scanDebt(files: SourceLike[]): DebtFinding[] {
  const out: DebtFinding[] = [];
  for (const f of files) {
    const lines = f.content.split("\n");
    lines.forEach((line, idx) => {
      // Markers (skip when the line is itself defining the regex/marker list — heuristic: only in comments).
      if (/\/\/|\/\*|\*/.test(line)) {
        for (const m of line.matchAll(MARKER_RE)) {
          const word = m[1]! as keyof typeof MARKER_KIND;
          out.push({
            kind: MARKER_KIND[word],
            file: f.rel,
            line: idx + 1,
            detail: (m[2] || word).trim().slice(0, 100),
            severity: MARKER_SEVERITY[word],
          });
        }
      }
      if (NOT_IMPLEMENTED_RE.test(line))
        out.push({
          kind: "not_implemented",
          file: f.rel,
          line: idx + 1,
          detail: 'throws "not implemented"',
          severity: "high",
        });
    });

    // Mock/demo leakage in non-test production code (conservative).
    if (!f.isTest && MOCK_LEAK_RE.test(f.content)) {
      out.push({
        kind: "mock_leakage",
        file: f.rel,
        detail: "mock/dummy/hardcoded data referenced in non-test code",
        severity: "medium",
      });
    }
    // Stub/placeholder mentioned in non-test code.
    if (!f.isTest && STUB_RE.test(f.content) && !MARKER_RE.test(f.content)) {
      out.push({
        kind: "stub",
        file: f.rel,
        detail: "stub/placeholder implementation referenced",
        severity: "medium",
      });
    }
  }
  return out;
}

// ---- activity ----------------------------------------------------------------

export interface ActivityInput {
  isDeprecated: boolean;
  dependentCount: number;
  ageDays?: number;
  private: boolean;
}

/**
 * Activity status, conservatively. "Dead" requires no dependents AND no recent
 * activity AND private — so a public or recently-touched package is never dead.
 */
export function determineActivity(input: ActivityInput): ActivityStatus {
  if (input.isDeprecated) return "deprecated";
  const age = input.ageDays;
  if ((age != null && age <= 30) || input.dependentCount >= 3) return "active";
  if (input.dependentCount === 0 && input.private && age != null && age >= 365)
    return "dead";
  if (input.dependentCount === 0 && (age == null || age >= 120))
    return "dormant";
  return "stale";
}

// ---- coverage ----------------------------------------------------------------

export function estimateCoverage(
  testCount: number,
  sourceCount: number,
  scenarioCount: number,
): CoverageLevel {
  if (testCount === 0 && scenarioCount === 0) return "none";
  const ratio = testCount / Math.max(1, sourceCount);
  if (ratio >= 0.5 || scenarioCount >= 3) return "high";
  if (ratio >= 0.2 || scenarioCount >= 1) return "medium";
  return "low";
}

// ---- debt scoring ------------------------------------------------------------

export interface DebtScoreInput {
  coverage: CoverageLevel;
  status: ActivityStatus;
  findings: DebtFinding[];
  healthScore?: number;
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/** 0..100 technical-debt score (higher = worse). Deterministic. */
export function scoreDebt(input: DebtScoreInput): number {
  let score = 0;

  // Missing tests.
  score +=
    input.coverage === "none"
      ? 25
      : input.coverage === "low"
        ? 15
        : input.coverage === "medium"
          ? 5
          : 0;

  // Staleness / death.
  score +=
    input.status === "dead"
      ? 25
      : input.status === "deprecated"
        ? 20
        : input.status === "dormant"
          ? 15
          : input.status === "stale"
            ? 8
            : 0;

  // Findings (TODO density + incomplete features).
  let findingPoints = 0;
  for (const f of input.findings) {
    findingPoints +=
      f.kind === "not_implemented"
        ? 12
        : f.kind === "dead_package"
          ? 15
          : f.kind === "dead_export"
            ? 3
            : f.kind === "mock_leakage" || f.kind === "stub"
              ? 6
              : f.severity === "medium"
                ? 3
                : 1;
  }
  score += clamp(findingPoints, 0, 35);

  // Runtime health.
  if (input.healthScore != null)
    score += input.healthScore < 60 ? 15 : input.healthScore < 80 ? 7 : 0;

  return Math.round(clamp(score, 0, 100));
}
