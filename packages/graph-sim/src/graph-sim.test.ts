import { describe, expect, it } from "vitest";
import type {
  DependencyEdge,
  DependencyNode,
} from "@package-workbench/plugin-sdk";
import { simulate } from "./simulate";
import { mutationsFromRefactor } from "./bridge";
import { exportSimulationMarkdown, exportArchitectureDiff } from "./export";

/**
 * Deterministic simulation tests. Graphs are built from raw nodes/edges; the
 * engine recomputes real metrics (cycles, health, violations) — so these assert
 * actual recomputation, not estimates. No repo is touched.
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

function graph(pairs: Array<[string, string]>, extra: string[] = []) {
  const ids = new Set<string>(extra);
  for (const [a, b] of pairs) {
    ids.add(a);
    ids.add(b);
  }
  return {
    nodes: [...ids].sort().map(node),
    edges: pairs.map(([a, b]) => edge(a, b)),
  };
}

const T = () => "T";

// ---- edge removal ------------------------------------------------------------

describe("remove_edge", () => {
  it("breaks a cycle and recomputes cycle count", () => {
    const g = graph([
      ["a", "b"],
      ["b", "a"],
    ]);
    const result = simulate(g, [{ type: "remove_edge", from: "b", to: "a" }], {
      now: T,
    });
    expect(result.before.cycleCount).toBe(1);
    expect(result.after.cycleCount).toBe(0);
    expect(result.impact.cycleReduction).toBe(1);
    expect(result.changedEdges).toContainEqual({
      from: "b",
      to: "a",
      change: "removed",
    });
  });
});

// ---- split simulation --------------------------------------------------------

describe("split_node", () => {
  it("splits a package into three and reduces cycles", () => {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < 6; i++) pairs.push([`c${i}`, "core"]);
    for (let i = 0; i < 6; i++) pairs.push(["core", `d${i}`]);
    pairs.push(["d0", "core"]); // cycle
    const result = simulate(
      graph(pairs),
      [
        {
          type: "split_node",
          id: "core",
          parts: {
            types: "core-types",
            runtime: "core-runtime",
            services: "core-services",
          },
        },
      ],
      { now: T },
    );
    expect(result.before.cycleCount).toBeGreaterThan(0);
    expect(result.after.cycleCount).toBe(0);
    expect(result.impact.nodeDelta).toBe(2); // -1 core, +3 parts
    expect(result.changedNodes).toContainEqual({
      id: "core-types",
      change: "added",
    });
    expect(result.impact.scoreDelta).toBeGreaterThan(0);
  });
});

// ---- merge simulation --------------------------------------------------------

describe("merge_nodes", () => {
  it("merges packages and collapses internal edges", () => {
    const g = graph([
      ["app", "utils"],
      ["app", "helpers"],
      ["utils", "helpers"],
    ]);
    const result = simulate(
      g,
      [{ type: "merge_nodes", ids: ["utils", "helpers"], into: "shared" }],
      { now: T },
    );
    expect(result.impact.nodeDelta).toBe(-1); // two → one
    expect(result.after.nodeCount).toBe(2); // app + shared
    expect(result.changedNodes).toContainEqual({
      id: "shared",
      change: "added",
    });
  });
});

// ---- boundary simulation -----------------------------------------------------

describe("add_boundary", () => {
  it("introduces a violation for an existing forbidden edge", () => {
    const g = graph([
      ["ui", "db"],
      ["app", "ui"],
    ]);
    const result = simulate(
      g,
      [{ type: "add_boundary", from: "ui", cannotDependOn: ["db"] }],
      { now: T },
    );
    expect(result.before.violationCount).toBe(0);
    expect(result.after.violationCount).toBe(1);
  });
});

// ---- determinism + bridge + export ------------------------------------------

describe("engine plumbing", () => {
  it("is deterministic", () => {
    const g = graph([
      ["a", "b"],
      ["b", "a"],
    ]);
    const a = simulate(g, [{ type: "remove_edge", from: "b", to: "a" }], {
      now: T,
    });
    const b = simulate(g, [{ type: "remove_edge", from: "b", to: "a" }], {
      now: T,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never mutates the input graph", () => {
    const g = graph([
      ["a", "b"],
      ["b", "a"],
    ]);
    const edgeCount = g.edges.length;
    simulate(
      g,
      [
        { type: "remove_edge", from: "b", to: "a" },
        {
          type: "split_node",
          id: "a",
          parts: { types: "a-t", runtime: "a-r", services: "a-s" },
        },
      ],
      { now: T },
    );
    expect(g.edges.length).toBe(edgeCount);
    expect(g.nodes.some((n) => n.id === "a-t")).toBe(false);
  });

  it("maps refactor suggestions to mutations", () => {
    const split = {
      strategy: "split_package",
      targetPackages: ["core"],
      newPackages: ["core-types", "core-runtime", "core-services"],
    } as never;
    expect(mutationsFromRefactor(split)[0]).toMatchObject({
      type: "split_node",
      id: "core",
    });
    const merge = {
      strategy: "merge_packages",
      targetPackages: ["a", "b"],
      newPackages: ["ab"],
    } as never;
    expect(mutationsFromRefactor(merge)[0]).toMatchObject({
      type: "merge_nodes",
      into: "ab",
    });
  });

  it("exports a markdown plan and an architecture diff", () => {
    const result = simulate(
      graph([
        ["a", "b"],
        ["b", "a"],
      ]),
      [{ type: "remove_edge", from: "b", to: "a" }],
      { now: T },
    );
    expect(exportSimulationMarkdown(result)).toContain(
      "Remove dependency b → a",
    );
    expect(exportArchitectureDiff(result)).toContain("| Cycles |");
  });
});
