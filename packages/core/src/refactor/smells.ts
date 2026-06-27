import type {
  CircularDependencyReport,
  DependencyGraph,
  DependencyNode,
} from "@package-workbench/plugin-sdk";
import type { ExportUsageReport } from "../intel/types";
import type { ArchitecturalProblem, ProblemSeverity } from "./types";

/**
 * Architectural smell detection for the Refactor Architect. Conservative by
 * design: thresholds are deliberately high so we flag *clear* problems, not
 * every imperfect package (avoiding over-refactoring is a hard requirement).
 * Every problem carries quantified metrics + cited graph evidence.
 */

// Thresholds (high on purpose — only flag clear cases).
const GOD_FANIN = 8;
const GOD_FANOUT = 8;
const OVERCOUPLED_DEGREE = 16;
const UTILITY_FANIN = 5;
const UTILITY_FANOUT_MAX = 2;
const FRAGMENT_MIN_PACKAGES = 4;
const FRAGMENT_MAX_DEGREE = 2;
const LEAKY_MIN_CONSUMERS = 3;

const UTILITY_NAME =
  /(^|[-/@])(utils?|common|shared|helpers?|misc|core-utils|lib)([-/]|$)/i;

export interface SmellOptions {
  /** Export-usage reports (from package intelligence) enable leaky-abstraction detection. */
  intel?: ExportUsageReport[];
}

function cyclesInvolving(
  cycles: CircularDependencyReport[],
  id: string,
): CircularDependencyReport[] {
  return cycles.filter((c) => c.cycle.includes(id) || c.affected.includes(id));
}

function sev(score: number): ProblemSeverity {
  if (score >= 3) return "critical";
  if (score >= 2) return "high";
  if (score >= 1) return "medium";
  return "low";
}

/** Detect all architectural problems in a graph. Conservative + deterministic. */
export function detectProblems(
  graph: DependencyGraph,
  opts: SmellOptions = {},
): ArchitecturalProblem[] {
  const problems: ArchitecturalProblem[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // ---- God packages -----------------------------------------------------------
  for (const n of graph.nodes) {
    const { fanIn, fanOut } = n.metrics;
    if (fanIn >= GOD_FANIN && fanOut >= GOD_FANOUT) {
      const involved = cyclesInvolving(graph.cycles, n.id);
      const score =
        (fanIn >= GOD_FANIN * 2 ? 1 : 0) +
        (fanOut >= GOD_FANOUT * 2 ? 1 : 0) +
        (involved.length > 0 ? 1 : 0) +
        1;
      problems.push({
        kind: "god_package",
        packageId: n.id,
        severity: sev(score),
        metrics: {
          fanIn,
          fanOut,
          cycles: involved.length,
          transitiveDependents: n.metrics.transitiveDependents,
        },
        evidence: [
          `${n.name} has fan-in ${fanIn}, fan-out ${fanOut}` +
            (involved.length ? `, and ${involved.length} cycle(s)` : ""),
          `${n.metrics.transitiveDependents} package(s) transitively depend on it`,
        ],
        detail: `${n.name} concentrates too many responsibilities: ${fanIn} dependents and ${fanOut} dependencies.`,
      });
    }
  }

  // ---- Overcoupled (high degree, not already a god package) -------------------
  const godIds = new Set(
    problems.filter((p) => p.kind === "god_package").map((p) => p.packageId),
  );
  for (const n of graph.nodes) {
    if (godIds.has(n.id)) continue;
    if (n.metrics.degree >= OVERCOUPLED_DEGREE) {
      problems.push({
        kind: "overcoupled",
        packageId: n.id,
        severity: sev(n.metrics.degree >= OVERCOUPLED_DEGREE * 1.5 ? 2 : 1),
        metrics: {
          degree: n.metrics.degree,
          fanIn: n.metrics.fanIn,
          fanOut: n.metrics.fanOut,
        },
        evidence: [
          `${n.name} has degree ${n.metrics.degree} (${n.metrics.fanIn} in + ${n.metrics.fanOut} out)`,
        ],
        detail: `${n.name} is highly coupled (degree ${n.metrics.degree}).`,
      });
    }
  }

  // ---- Utility blob -----------------------------------------------------------
  for (const n of graph.nodes) {
    if (godIds.has(n.id)) continue;
    if (
      UTILITY_NAME.test(n.name) &&
      n.metrics.fanIn >= UTILITY_FANIN &&
      n.metrics.fanOut <= UTILITY_FANOUT_MAX
    ) {
      problems.push({
        kind: "utility_blob",
        packageId: n.id,
        severity: sev(n.metrics.fanIn >= UTILITY_FANIN * 2 ? 2 : 1),
        metrics: { fanIn: n.metrics.fanIn, fanOut: n.metrics.fanOut },
        evidence: [
          `${n.name} is a catch-all: ${n.metrics.fanIn} dependents but only ${n.metrics.fanOut} dependencies`,
        ],
        detail: `${n.name} looks like a grab-bag utility that ${n.metrics.fanIn} packages reach into.`,
      });
    }
  }

  // ---- Layer violations -------------------------------------------------------
  for (const v of graph.violations) {
    problems.push({
      kind: "layer_violation",
      packageId: v.from,
      packages: [v.from, v.to],
      severity:
        v.severity === "high"
          ? "high"
          : v.severity === "medium"
            ? "medium"
            : "low",
      metrics: {},
      evidence: [`${v.from} → ${v.to} violates "${v.rule}"`],
      detail: `${v.from} depends on ${v.to}, which the architecture rule "${v.rule}" forbids.`,
    });
  }

  // ---- Dependency cycles ------------------------------------------------------
  for (const c of graph.cycles) {
    problems.push({
      kind: "dependency_cycle",
      packages: c.cycle,
      packageId: c.cycle[0],
      severity:
        c.severity === "critical"
          ? "critical"
          : c.severity === "high"
            ? "high"
            : c.severity === "medium"
              ? "medium"
              : "low",
      metrics: { length: c.cycle.length, affected: c.affected.length },
      evidence: [
        `Cycle: ${c.cycle.join(" → ")}${c.cycle.length > 1 ? " → " + c.cycle[0] : ""}`,
      ],
      detail: `A ${c.kind} ${c.severity}-severity cycle across ${c.cycle.length} package(s).`,
    });
  }

  // ---- Feature fragmentation --------------------------------------------------
  problems.push(...detectFragmentation(graph.nodes));

  // ---- Leaky abstraction (needs intel) ----------------------------------------
  if (opts.intel)
    problems.push(...detectLeakyAbstraction(graph, opts.intel, nodeById));

  // Worst first.
  const rank: Record<ProblemSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return problems.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Group tiny packages by domain prefix; many small siblings = fragmentation. */
function detectFragmentation(nodes: DependencyNode[]): ArchitecturalProblem[] {
  const groups = new Map<string, DependencyNode[]>();
  for (const n of nodes) {
    if (n.metrics.degree > FRAGMENT_MAX_DEGREE) continue;
    const prefix = domainPrefix(n.name);
    if (!prefix) continue;
    (groups.get(prefix) ?? groups.set(prefix, []).get(prefix)!).push(n);
  }
  const out: ArchitecturalProblem[] = [];
  for (const [prefix, members] of groups) {
    if (members.length < FRAGMENT_MIN_PACKAGES) continue;
    out.push({
      kind: "feature_fragmentation",
      packages: members.map((m) => m.id).sort(),
      severity: members.length >= FRAGMENT_MIN_PACKAGES * 2 ? "high" : "medium",
      metrics: { count: members.length },
      evidence: [
        `${members.length} tiny packages under "${prefix}*": ${members
          .slice(0, 6)
          .map((m) => m.name)
          .join(", ")}`,
      ],
      detail: `The "${prefix}" domain is fragmented across ${members.length} small packages — consider consolidating.`,
    });
  }
  return out;
}

/** `@scope/feature-foo` → `@scope/feature`; `feature-foo` → `feature`. */
function domainPrefix(name: string): string | null {
  const m = name.match(/^(@[^/]+\/)?([a-z0-9]+)[-_]/i);
  if (!m) return null;
  return `${m[1] ?? ""}${m[2]}`;
}

/** Types from an impl package consumed by many packages = a leaky abstraction. */
function detectLeakyAbstraction(
  graph: DependencyGraph,
  intel: ExportUsageReport[],
  nodeById: Map<string, DependencyNode>,
): ArchitecturalProblem[] {
  const out: ArchitecturalProblem[] = [];
  for (const usage of intel) {
    const node = nodeById.get(usage.packageId);
    if (!node || node.metrics.fanOut === 0) continue; // pure types package is fine
    const typeExports = usage.exports.filter(
      (e) => e.symbol.typeOnly && e.usageClass === "used",
    );
    const consumers = new Set<string>();
    for (const e of typeExports) for (const c of e.consumers) consumers.add(c);
    if (typeExports.length >= 2 && consumers.size >= LEAKY_MIN_CONSUMERS) {
      out.push({
        kind: "leaky_abstraction",
        packageId: usage.packageId,
        severity: consumers.size >= LEAKY_MIN_CONSUMERS * 2 ? "high" : "medium",
        metrics: {
          typeExports: typeExports.length,
          consumers: consumers.size,
          fanOut: node.metrics.fanOut,
        },
        evidence: [
          `${usage.packageName} exposes ${typeExports.length} type(s) used by ${consumers.size} package(s), yet also has ${node.metrics.fanOut} runtime dependencies`,
        ],
        detail: `${usage.packageName} mixes implementation with widely-consumed types — extract the types so consumers don't depend on the implementation package.`,
      });
    }
  }
  return out;
}
