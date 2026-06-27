import type {
  ArchitecturalSmell,
  BoundaryViolation,
  CircularDependencyReport,
  DependencyEdge,
  GraphHealthReport,
  ViolationSeverity,
} from "@package-workbench/plugin-sdk";
import { scoreToGrade } from "@package-workbench/plugin-sdk";

/**
 * Deterministic 0..100 graph-health score: start at 100 and subtract capped
 * penalties for cycles, boundary violations, coupling, orphans, and broken
 * layering. The per-factor breakdown is returned so the UI/CLI can explain it.
 */

const CYCLE_PENALTY = { critical: 25, high: 15, medium: 8, low: 4 } as const;
const VIOLATION_PENALTY: Record<ViolationSeverity, number> = {
  high: 12,
  medium: 6,
  low: 3,
};
const COUPLING_PENALTY: Record<ViolationSeverity, number> = {
  high: 8,
  medium: 4,
  low: 2,
};

const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.max(lo, Math.min(hi, n));
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export interface GraphHealthInput {
  cycles: CircularDependencyReport[];
  violations: BoundaryViolation[];
  smells: ArchitecturalSmell[];
  inversions: DependencyEdge[];
  orphanCount: number;
}

export function computeGraphHealth(input: GraphHealthInput): GraphHealthReport {
  const factors: GraphHealthReport["factors"] = [];
  const add = (label: string, penalty: number, detail: string): void => {
    if (penalty > 0) factors.push({ label, penalty, detail });
  };

  const cyclePenalty = Math.min(
    45,
    sum(input.cycles.map((c) => CYCLE_PENALTY[c.severity])),
  );
  add("Circular dependencies", cyclePenalty, `${input.cycles.length} cycle(s)`);

  const violationPenalty = Math.min(
    30,
    sum(input.violations.map((v) => VIOLATION_PENALTY[v.severity])),
  );
  add(
    "Boundary violations",
    violationPenalty,
    `${input.violations.length} rule break(s)`,
  );

  const couplingSmells = input.smells.filter(
    (s) =>
      s.kind === "god_package" ||
      s.kind === "high_coupling" ||
      s.kind === "dependency_explosion",
  );
  const couplingPenalty = Math.min(
    20,
    sum(couplingSmells.map((s) => COUPLING_PENALTY[s.severity])),
  );
  add(
    "Coupling",
    couplingPenalty,
    `${couplingSmells.length} highly-coupled / god package(s)`,
  );

  const orphanPenalty = Math.min(12, input.orphanCount * 2);
  add("Orphans", orphanPenalty, `${input.orphanCount} isolated package(s)`);

  const layeringPenalty = Math.min(20, input.inversions.length * 5);
  add(
    "Layering",
    layeringPenalty,
    `${input.inversions.length} layer inversion(s)`,
  );

  const score = clamp(
    Math.round(
      100 -
        cyclePenalty -
        violationPenalty -
        couplingPenalty -
        orphanPenalty -
        layeringPenalty,
    ),
  );
  return { score, grade: scoreToGrade(score), factors };
}
