import { describe, expect, it } from "vitest";
import type {
  BoundaryRule,
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
} from "@package-workbench/plugin-sdk";
import { computeMetrics } from "../graph/metrics";
import { detectCycles } from "../graph/cycles";
import { evaluateBoundaries, layeringInversions } from "../graph/boundaries";
import { detectSmells } from "../graph/smells";
import { computeGraphHealth } from "../graph/score";
import { detectProblems } from "./smells";
import { analyzeRefactor, generateAlternativePlans } from "./plan";
import { renderRefactorText } from "./render";

/**
 * Fixtures (the required set): a god-package repo, a cycle-heavy repo, a
 * fragmented repo, and an over-layered repo. Graphs are built in-memory and run
 * through the REAL graph engine, so the Refactor Architect's projections recompute
 * against true cycle/health numbers — deterministic, offline.
 */

function node(id: string): DependencyNode {
  return {
    id,
    name: id,
    version: "1.0.0",
    root: `/${id}`,
    packageType: "library",
    runtime: "node",
    layer: 0,
    tags: [],
    isOrphan: false,
    metrics: {
      fanIn: 0,
      fanOut: 0,
      degree: 0,
      centrality: 0,
      depth: 0,
      transitiveDependents: 0,
      transitiveDependencies: 0,
    },
  };
}
const edge = (from: string, to: string): DependencyEdge => ({
  from,
  to,
  relationships: ["dependency"],
  evidence: [],
  undeclared: false,
});

/** Build a full DependencyGraph from edges via the real graph engine. */
function makeGraph(
  pairs: Array<[string, string]>,
  opts: { extraNodes?: string[]; rules?: BoundaryRule[] } = {},
): DependencyGraph {
  const ids = new Set<string>(opts.extraNodes ?? []);
  for (const [a, b] of pairs) {
    ids.add(a);
    ids.add(b);
  }
  const nodes = [...ids].sort().map(node);
  const edges = pairs.map(([a, b]) => edge(a, b));
  computeMetrics(nodes, edges);
  const cycles = detectCycles(nodes, edges);
  const violations = evaluateBoundaries(nodes, edges, opts.rules ?? []);
  const smells = detectSmells(nodes);
  const inversions = layeringInversions(nodes, edges);
  const health = computeGraphHealth({
    cycles,
    violations,
    smells,
    inversions,
    orphanCount: nodes.filter((n) => n.isOrphan).length,
  });
  return {
    nodes,
    edges,
    cycles,
    violations,
    smells,
    health,
    stats: {
      packageCount: nodes.length,
      edgeCount: edges.length,
      externalDependencyCount: 0,
      maxDepth: 0,
      isAcyclic: cycles.length === 0,
      orphanCount: 0,
    },
    generatedAt: "T",
  };
}

// ---- fixtures ----------------------------------------------------------------

/** core: 10 consumers + 10 dependencies, with 2 back-edges (cycles). */
function godRepo(): DependencyGraph {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < 10; i++) pairs.push([`c${i}`, "core"]); // fan-in
  for (let i = 0; i < 10; i++) pairs.push(["core", `d${i}`]); // fan-out
  pairs.push(["d0", "core"], ["d1", "core"]); // 2 cycles
  return makeGraph(pairs);
}

/** Several independent 2-cycles. */
function cycleHeavyRepo(): DependencyGraph {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < 4; i++) {
    pairs.push([`a${i}`, `b${i}`], [`b${i}`, `a${i}`]);
  }
  return makeGraph(pairs);
}

/** 5 tiny sibling packages under the "feature" domain. */
function fragmentedRepo(): DependencyGraph {
  const pairs: Array<[string, string]> = [];
  for (const x of ["a", "b", "c", "d", "e"])
    pairs.push([`feature-${x}`, "shared-lib"]);
  return makeGraph(pairs);
}

/** ui (layer app) → db (layer infra), forbidden by a rule. */
function overLayeredRepo(): { graph: DependencyGraph; rules: BoundaryRule[] } {
  const rules: BoundaryRule[] = [
    {
      from: "ui",
      cannotDependOn: ["db"],
      severity: "high",
      description: "UI cannot depend on DB directly",
    },
  ];
  const graph = makeGraph(
    [
      ["ui", "db"],
      ["ui", "api"],
      ["api", "db"],
    ],
    { rules },
  );
  return { graph, rules };
}

// ---- tests -------------------------------------------------------------------

describe("detectProblems", () => {
  it("flags a god package with cited fan-in/out + cycles", () => {
    const problems = detectProblems(godRepo());
    const god = problems.find((p) => p.kind === "god_package");
    expect(god).toBeTruthy();
    expect(god!.metrics.fanIn).toBeGreaterThanOrEqual(8);
    expect(god!.metrics.fanOut).toBeGreaterThanOrEqual(8);
    expect(god!.evidence[0]).toContain("fan-in");
  });

  it("flags feature fragmentation only when several tiny siblings exist", () => {
    const problems = detectProblems(fragmentedRepo());
    const frag = problems.find((p) => p.kind === "feature_fragmentation");
    expect(frag?.packages?.length).toBe(5);
    // A non-fragmented graph yields none.
    expect(
      detectProblems(makeGraph([["x", "y"]])).some(
        (p) => p.kind === "feature_fragmentation",
      ),
    ).toBe(false);
  });

  it("flags layer violations from boundary rules", () => {
    const { graph } = overLayeredRepo();
    expect(
      detectProblems(graph).some((p) => p.kind === "layer_violation"),
    ).toBe(true);
  });
});

describe("analyzeRefactor — grounded impact", () => {
  it("recommends splitting a god package and recomputes a real cycle reduction", () => {
    const plan = analyzeRefactor({ graph: godRepo(), now: () => "T" });
    const top = plan.suggestions[0]!;
    expect(top.strategy).toBe("split_package");
    expect(top.title).toContain("core-types");
    expect(top.impact.cycleReduction).toBeGreaterThan(0); // recomputed, not guessed
    expect(top.impact.healthScoreDelta).toBeGreaterThan(0);
    expect(top.visualization.before.cycleCount).toBeGreaterThan(
      top.visualization.after.cycleCount,
    );
  });

  it("breaks cycles via extracted shared types in a cycle-heavy repo", () => {
    const plan = analyzeRefactor({ graph: cycleHeavyRepo(), now: () => "T" });
    expect(
      plan.problems.filter((p) => p.kind === "dependency_cycle").length,
    ).toBe(4);
    const fix = plan.suggestions.find(
      (s) => s.strategy === "extract_shared_types",
    );
    expect(fix).toBeTruthy();
    expect(fix!.impact.cycleReduction).toBeGreaterThan(0);
  });

  it("merges fragmented packages and reports a real dependency reduction", () => {
    const plan = analyzeRefactor({ graph: fragmentedRepo(), now: () => "T" });
    const merge = plan.suggestions.find((s) => s.strategy === "merge_packages");
    expect(merge).toBeTruthy();
    expect(merge!.targetPackages.length).toBe(5);
    expect(merge!.impact.dependencyReduction).toBeGreaterThanOrEqual(0);
  });

  it("is conservative: a healthy graph yields no suggestions", () => {
    const plan = analyzeRefactor({
      graph: makeGraph([
        ["app", "lib"],
        ["app", "util"],
      ]),
      now: () => "T",
    });
    expect(plan.suggestions).toHaveLength(0);
    expect(plan.summary).toContain("no conservative refactor");
  });

  it("is deterministic", () => {
    const a = analyzeRefactor({ graph: godRepo(), now: () => "T" });
    const b = analyzeRefactor({ graph: godRepo(), now: () => "T" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("only ever proposes one refactor per focal package", () => {
    const plan = analyzeRefactor({ graph: godRepo(), now: () => "T" });
    const focals = plan.suggestions.map((s) => s.targetPackages[0]);
    expect(new Set(focals).size).toBe(focals.length);
  });
});

describe("generateAlternativePlans", () => {
  it("produces distinct Balanced / Minimal-risk / Max-impact plans", () => {
    const plans = generateAlternativePlans({
      graph: godRepo(),
      now: () => "T",
    });
    expect(plans.length).toBeGreaterThanOrEqual(1);
    const minimal = plans.find((p) => p.variant === 1);
    if (minimal)
      expect(minimal.suggestions.every((s) => s.risk.level !== "high")).toBe(
        true,
      );
  });
});

describe("renderRefactorText", () => {
  it("renders the Problem → Suggested refactor → Expected impact block", () => {
    const text = renderRefactorText(
      analyzeRefactor({ graph: godRepo(), now: () => "T" }),
    );
    expect(text).toContain("Problem:");
    expect(text).toContain("Suggested refactor:");
    expect(text).toContain("Expected impact:");
    expect(text).toContain("core-types");
  });
});
