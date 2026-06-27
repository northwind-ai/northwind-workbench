import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeGraphLayout,
  type DependencyEdge,
  type DependencyNode,
  type NodeMetrics,
} from "@package-workbench/plugin-sdk";
import { computeMetrics } from "./metrics";
import { detectCycles } from "./cycles";
import { evaluateBoundaries } from "./boundaries";
import { detectSmells } from "./smells";
import { computeGraphHealth } from "./score";
import { analyzeDependencyGraph } from "./index";
import { loadBoundaryRules } from "./rules-config";
import { scanWorkspace } from "../scanner";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/graph",
);

const zeroMetrics = (): NodeMetrics => ({
  fanIn: 0,
  fanOut: 0,
  degree: 0,
  centrality: 0,
  depth: 0,
  transitiveDependents: 0,
  transitiveDependencies: 0,
});

function node(id: string, extra: Partial<DependencyNode> = {}): DependencyNode {
  return {
    id,
    name: id,
    version: "1.0.0",
    root: `/${id}`,
    packageType: "library",
    runtime: "node",
    layer: 1,
    tags: [],
    isOrphan: false,
    metrics: zeroMetrics(),
    ...extra,
  };
}
const edge = (from: string, to: string): DependencyEdge => ({
  from,
  to,
  relationships: ["dependency"],
  evidence: [],
  undeclared: false,
});

describe("computeMetrics", () => {
  it("computes fan-in/out, depth and transitive counts", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id));
    const edges = [edge("a", "b"), edge("b", "c")];
    computeMetrics(nodes, edges);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.a!.metrics.fanOut).toBe(1);
    expect(byId.a!.metrics.depth).toBe(2);
    expect(byId.a!.metrics.transitiveDependencies).toBe(2);
    expect(byId.c!.metrics.fanIn).toBe(1);
    expect(byId.c!.metrics.transitiveDependents).toBe(2);
  });

  it("marks isolated nodes as orphans", () => {
    const nodes = [node("a"), node("lonely")];
    computeMetrics(nodes, [edge("a", "a")]); // self edge ignored by adjacency
    expect(nodes.find((n) => n.id === "lonely")!.isOrphan).toBe(true);
  });
});

describe("detectCycles", () => {
  it("finds an indirect cycle a→b→c→a", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id));
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    computeMetrics(nodes, edges);
    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.kind).toBe("indirect");
    expect(cycles[0]!.affected.sort()).toEqual(["a", "b", "c"]);
  });

  it("finds a direct cycle a↔b", () => {
    const nodes = ["a", "b"].map((id) => node(id));
    const edges = [edge("a", "b"), edge("b", "a")];
    computeMetrics(nodes, edges);
    const cycles = detectCycles(nodes, edges);
    expect(cycles[0]!.kind).toBe("direct");
  });

  it("finds a self cycle", () => {
    const nodes = [node("a")];
    const cycles = detectCycles(nodes, [edge("a", "a")]);
    expect(cycles[0]!.kind).toBe("self");
  });

  it("reports no cycles for a DAG", () => {
    const nodes = ["a", "b"].map((id) => node(id));
    expect(detectCycles(nodes, [edge("a", "b")])).toHaveLength(0);
  });
});

describe("evaluateBoundaries", () => {
  const nodes = [
    node("core", { tags: ["domain"] }),
    node("ui", { tags: ["presentation"] }),
  ];
  it("flags a forbidden dependency (cannotDependOn)", () => {
    const v = evaluateBoundaries(
      nodes,
      [edge("core", "ui")],
      [{ from: "core", cannotDependOn: ["ui"] }],
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("high");
  });
  it("flags via tag selectors", () => {
    const v = evaluateBoundaries(
      nodes,
      [edge("core", "ui")],
      [{ from: "tag:domain", cannotDependOn: ["tag:presentation"] }],
    );
    expect(v).toHaveLength(1);
  });
  it("enforces canOnlyDependOn allow-lists", () => {
    const v = evaluateBoundaries(
      nodes,
      [edge("core", "ui")],
      [{ from: "core", canOnlyDependOn: ["shared"] }],
    );
    expect(v).toHaveLength(1);
  });
  it("allows permitted edges", () => {
    const v = evaluateBoundaries(
      nodes,
      [edge("ui", "core")],
      [{ from: "core", cannotDependOn: ["ui"] }],
    );
    expect(v).toHaveLength(0);
  });
});

describe("detectSmells", () => {
  it("flags a god package by fan-in", () => {
    const hub = node("hub");
    const nodes = [hub, ...Array.from({ length: 6 }, (_, i) => node(`d${i}`))];
    const edges = nodes.slice(1).map((n) => edge(n.id, "hub"));
    computeMetrics(nodes, edges);
    const smells = detectSmells(nodes);
    expect(
      smells.some((s) => s.kind === "god_package" && s.packageId === "hub"),
    ).toBe(true);
  });

  it("flags duplicate utility packages", () => {
    const nodes = [node("@x/utils"), node("@x/helpers"), node("@x/app")];
    const smells = detectSmells(nodes);
    expect(smells.filter((s) => s.kind === "duplicate_utility").length).toBe(2);
  });
});

describe("computeGraphHealth", () => {
  it("penalises cycles and violations", () => {
    const health = computeGraphHealth({
      cycles: [
        {
          cycle: ["a", "b"],
          kind: "direct",
          severity: "high",
          affected: ["a", "b"],
        },
      ],
      violations: [
        {
          from: "a",
          to: "b",
          rule: "x",
          severity: "high",
          relationships: ["dependency"],
        },
      ],
      smells: [],
      inversions: [],
      orphanCount: 0,
    });
    expect(health.score).toBe(100 - 15 - 12);
    expect(health.grade).toBe("C");
  });

  it("is 100/A for a clean graph", () => {
    const health = computeGraphHealth({
      cycles: [],
      violations: [],
      smells: [],
      inversions: [],
      orphanCount: 0,
    });
    expect(health.score).toBe(100);
    expect(health.grade).toBe("A");
  });
});

describe("computeGraphLayout", () => {
  it("places dependency roots and leaves on different layers", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id));
    const layout = computeGraphLayout({
      nodes,
      edges: [edge("a", "b"), edge("b", "c")],
    });
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));
    expect(byId.a!.layer).toBeLessThan(byId.c!.layer);
    expect(layout.layerCount).toBe(3);
  });
});

describe("analyzeDependencyGraph (fixtures)", () => {
  async function analyze(
    name: string,
    rules: Awaited<ReturnType<typeof loadBoundaryRules>> = [],
  ) {
    const root = join(FIXTURES, name);
    const { packages } = await scanWorkspace(root);
    return analyzeDependencyGraph(packages, {
      workspaceRoot: root,
      rules,
      now: () => "T",
    });
  }

  it("healthy layered repo: acyclic, layered, import-discovered edge", async () => {
    const g = await analyze("healthy");
    expect(g.stats.isAcyclic).toBe(true);
    expect(g.cycles).toHaveLength(0);
    // app imports @h/core without declaring it → an undeclared import edge.
    const appToCore = g.edges.find(
      (e) => e.from === "@h/app" && e.to === "@h/core",
    );
    expect(appToCore?.undeclared).toBe(true);
    // core has the highest fan-in.
    const core = g.nodes.find((n) => n.id === "@h/core")!;
    expect(core.metrics.fanIn).toBeGreaterThanOrEqual(3);
    expect(g.health.grade).toMatch(/[AB]/);
  });

  it("circular repo: detects the a→b→c→a cycle", async () => {
    const g = await analyze("circular");
    expect(g.stats.isAcyclic).toBe(false);
    expect(g.cycles[0]!.affected).toEqual(["@c/a", "@c/b", "@c/c"]);
  });

  it("violation repo: flags the configured boundary break", async () => {
    const root = join(FIXTURES, "violation");
    const rules = await loadBoundaryRules(root);
    const g = await analyze("violation", rules);
    expect(rules).toHaveLength(1);
    expect(g.violations).toHaveLength(1);
    expect(g.violations[0]!).toMatchObject({ from: "@v/core", to: "@v/ui" });
  });

  it("orphan repo: detects the isolated package", async () => {
    const g = await analyze("orphan");
    expect(g.nodes.find((n) => n.id === "@o/lonely")!.isOrphan).toBe(true);
    expect(
      g.smells.some((s) => s.kind === "orphan" && s.packageId === "@o/lonely"),
    ).toBe(true);
  });
});
