import type {
  ArchitecturalSmell,
  DependencyNode,
  ViolationSeverity,
} from "@package-workbench/plugin-sdk";

/**
 * Architectural smell detection from node metrics. Thresholds scale with graph
 * size so the same heuristics work for a 5-package and a 500-package repo.
 */

const UTILITY_TOKENS = new Set([
  "utils",
  "util",
  "utilities",
  "helpers",
  "helper",
  "common",
  "commons",
  "shared",
  "misc",
  "core-utils",
]);

function baseName(name: string): string {
  const last = name.split("/").pop() ?? name;
  return last.toLowerCase();
}

function sev(value: number, med: number, high: number): ViolationSeverity {
  return value >= high ? "high" : value >= med ? "medium" : "low";
}

export function detectSmells(nodes: DependencyNode[]): ArchitecturalSmell[] {
  const smells: ArchitecturalSmell[] = [];
  const n = nodes.length;

  // Size-relative thresholds (with sensible floors).
  const godFanIn = Math.max(5, Math.ceil(n * 0.5));
  const explosionFanOut = Math.max(8, Math.ceil(n * 0.4));
  const couplingDegree = Math.max(8, Math.ceil(n * 0.6));

  for (const node of nodes) {
    const { fanIn, fanOut, degree } = node.metrics;

    if (fanIn >= godFanIn) {
      smells.push({
        kind: "god_package",
        packageId: node.id,
        severity: sev(fanIn, godFanIn, godFanIn * 1.5),
        detail: `${fanIn} packages depend on this (a change here ripples widely)`,
        metric: fanIn,
      });
    }
    if (fanOut >= explosionFanOut) {
      smells.push({
        kind: "dependency_explosion",
        packageId: node.id,
        severity: sev(fanOut, explosionFanOut, explosionFanOut * 1.5),
        detail: `Depends on ${fanOut} internal packages`,
        metric: fanOut,
      });
    }
    if (fanIn > 0 && fanOut > 0 && degree >= couplingDegree) {
      smells.push({
        kind: "high_coupling",
        packageId: node.id,
        severity: sev(degree, couplingDegree, couplingDegree * 1.5),
        detail: `High coupling: fan-in ${fanIn}, fan-out ${fanOut}`,
        metric: degree,
      });
    }
    if (node.isOrphan) {
      smells.push({
        kind: "orphan",
        packageId: node.id,
        severity: "low",
        detail: "No internal dependents or dependencies (isolated package)",
      });
    } else if (fanIn === 0 && node.packageType === "library") {
      smells.push({
        kind: "dead_package",
        packageId: node.id,
        severity: "medium",
        detail:
          "A library that nothing in the workspace depends on (possibly dead code)",
      });
    }
  }

  // Duplicate utility packages — multiple packages sharing a utility-ish name.
  const byToken = new Map<string, string[]>();
  for (const node of nodes) {
    const token = baseName(node.name);
    if (UTILITY_TOKENS.has(token)) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token)!.push(node.id);
    }
  }
  // Any two utility-ish packages are duplicate candidates (even across token names).
  const allUtil = [...byToken.values()].flat();
  if (allUtil.length > 1) {
    for (const id of allUtil) {
      smells.push({
        kind: "duplicate_utility",
        packageId: id,
        severity: "low",
        detail:
          "Multiple utility/common packages exist — consider consolidating",
        related: allUtil.filter((x) => x !== id),
      });
    }
  }

  return smells;
}
