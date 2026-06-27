import type { BlastRadius, HistoricalRun } from "@package-workbench/core";
import type {
  ChangedFile,
  ChangedPackageInfo,
  DiffRisk,
  DiffRiskFactor,
  DiffRiskLevel,
} from "./types";

/**
 * Change-risk scoring. Combines five signals into a 0..100 score + level, each
 * itemised so the verdict is explainable: file types changed, the centrality of
 * what was edited, how many packages transitively depend on it, the blast-radius
 * coverage, and historical instability. Deterministic.
 *
 * A README change scores Low; a change to a high-centrality core package with
 * many dependents scores Critical.
 */

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/** Classify a changed file into a risk-weighted category. */
export function classifyFile(path: string): {
  category: string;
  weight: number;
} {
  const p = path.toLowerCase();
  if (/(^|\/)(readme|changelog|license)|\.(md|txt|mdx)$/.test(p))
    return { category: "docs", weight: 0 };
  if (/\.(test|spec)\.[jt]sx?$|(^|\/)__tests__\//.test(p))
    return { category: "test", weight: 1 };
  if (/package\.json$/.test(p)) return { category: "manifest", weight: 8 };
  if (/(^|\/)(index|exports|main)\.[jt]sx?$|\.d\.ts$/.test(p))
    return { category: "entry", weight: 9 };
  if (/\.(json|ya?ml|toml)$/.test(p)) return { category: "config", weight: 4 };
  if (/\.[jt]sx?$/.test(p)) return { category: "source", weight: 5 };
  return { category: "other", weight: 2 };
}

function levelFor(score: number): DiffRiskLevel {
  if (score >= 75) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

export interface RiskInput {
  changed: ChangedPackageInfo[];
  blastRadius: BlastRadius;
  changedFiles: ChangedFile[];
  /** Recent history, for instability (newest first). */
  history?: HistoricalRun[];
}

export function scoreDiffRisk(input: RiskInput): DiffRisk {
  const factors: DiffRiskFactor[] = [];
  const edited = input.changed.filter((c) => c.reason === "edited");

  // 1) File types changed.
  const fileWeight = input.changedFiles.reduce(
    (sum, f) => sum + classifyFile(f.path).weight,
    0,
  );
  const filePoints = clamp(fileWeight, 0, 25);
  if (filePoints > 0) {
    const categories = tally(
      input.changedFiles.map((f) => classifyFile(f.path).category),
    );
    factors.push({
      label: "File types changed",
      points: filePoints,
      detail: Object.entries(categories)
        .map(([c, n]) => `${n} ${c}`)
        .join(", "),
    });
  }

  // 2) Centrality of edited packages.
  const maxCentrality = Math.max(0, ...edited.map((c) => c.centrality));
  if (maxCentrality > 0)
    factors.push({
      label: "Edited package centrality",
      points: clamp(maxCentrality * 30, 0, 30),
      detail: `max centrality ${maxCentrality.toFixed(2)}`,
    });

  // 3) Dependents (how far it ripples).
  const topByDependents = [...edited].sort(
    (a, b) => b.dependents - a.dependents,
  )[0];
  const maxDependents = topByDependents?.dependents ?? 0;
  if (maxDependents > 0)
    factors.push({
      label: "Transitive dependents",
      points: clamp(maxDependents * 2, 0, 30),
      detail: `${topByDependents!.name} has ${maxDependents} dependents`,
    });

  // 4) Blast-radius coverage.
  if (input.blastRadius.total.length > 0) {
    factors.push({
      label: "Blast radius",
      points: clamp(input.blastRadius.coverage * 25, 0, 25),
      detail: `${input.blastRadius.impacted.length} impacted (${Math.round(input.blastRadius.coverage * 100)}% of workspace)`,
    });
  }

  // 5) Historical instability of edited packages.
  if (input.history && input.history.length > 0) {
    const editedIds = new Set(edited.map((c) => c.id));
    const unstable = unstablePackages(input.history).filter((id) =>
      editedIds.has(id),
    );
    if (unstable.length > 0)
      factors.push({
        label: "Historical instability",
        points: clamp(unstable.length * 8, 0, 20),
        detail: `${unstable.join(", ")} failed recently`,
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
  const reason =
    maxDependents >= 5
      ? `${topByDependents!.name} has ${maxDependents} dependents`
      : (factors[0]?.detail ?? "small, contained change");
  return { level: levelFor(score), score, factors, reason };
}

function tally(items: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}

function unstablePackages(history: HistoricalRun[]): string[] {
  const counts = new Map<string, number>();
  for (const run of history.slice(0, 5))
    for (const p of run.packages)
      if (p.status === "fail") counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
}
