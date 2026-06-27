import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  assemblePackageInfo,
  type DependencyGraph,
  type DependencyNode,
  type HealthCheckResult,
  type HistoricalRun,
  type PackageInfo,
  type WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import type { PackageHealthReport, WorkbenchRun } from "../types";
import { summarize } from "../scoring";
import {
  attributeFiles,
  computeBlastRadius,
  transitiveDependents,
  analyzeImpact,
} from "./blast-radius";
import { assessRisk } from "./risk";
import { decideMerge } from "./policy";
import { analyzePullRequest } from "./analyze";
import { renderPrReview, scoreLine } from "./report";
import { githubAnnotations, githubCheckConclusion } from "./github";
import { DEFAULT_MERGE_POLICY } from "./types";

/**
 * PR fixtures model three diff shapes: a SAFE PR (no regressions), a RISKY PR (a
 * minor regression in a low-centrality package), and a BREAKING PR (a new cycle
 * plus a critical failure in a central package). Everything is built in-memory —
 * deterministic, offline, no scanning.
 */

const ROOT = "/repo";
const workspace: WorkspaceInfo = {
  root: ROOT,
  name: "repo",
  packageManager: "pnpm",
  isMonorepo: true,
  packageCount: 4,
  tooling: {
    packageJson: true,
    pnpmWorkspace: true,
    nx: false,
    turbo: false,
    tsconfigBase: false,
  },
  warnings: [],
};

function pkg(name: string, dir: string): PackageInfo {
  return assemblePackageInfo({
    root: join(ROOT, dir),
    packageJsonPath: join(ROOT, dir, "package.json"),
    manifest: { name, version: "1.0.0" },
  });
}

const PACKAGES = {
  core: pkg("@nw/core", "packages/core"),
  a: pkg("@nw/a", "packages/a"),
  b: pkg("@nw/b", "packages/b"),
  app: pkg("@nw/app", "apps/app"),
};

function node(
  id: string,
  centrality: number,
  transitiveDependents: number,
): DependencyNode {
  return {
    id,
    name: id,
    version: "1.0.0",
    root: "/",
    packageType: "library",
    runtime: "node",
    layer: 0,
    tags: [],
    isOrphan: false,
    metrics: {
      fanIn: 0,
      fanOut: 0,
      degree: 0,
      centrality,
      depth: 0,
      transitiveDependents,
      transitiveDependencies: 0,
    },
  };
}

/** core ← a, core ← b, a ← app, b ← app. Editing core impacts a, b, app. */
function graph(opts: { cycle?: string[] } = {}): DependencyGraph {
  const edge = (from: string, to: string) => ({
    from,
    to,
    relationships: ["dependency" as const],
    evidence: [],
    undeclared: false,
  });
  return {
    nodes: [
      node("@nw/core", 0.9, 3),
      node("@nw/a", 0.4, 1),
      node("@nw/b", 0.4, 1),
      node("@nw/app", 0.1, 0),
    ],
    edges: [
      edge("@nw/a", "@nw/core"),
      edge("@nw/b", "@nw/core"),
      edge("@nw/app", "@nw/a"),
      edge("@nw/app", "@nw/b"),
    ],
    cycles: opts.cycle
      ? [
          {
            cycle: opts.cycle,
            kind: "indirect",
            severity: "high",
            affected: opts.cycle,
          },
        ]
      : [],
    violations: [],
    smells: [],
    health: {
      score: opts.cycle ? 60 : 95,
      grade: opts.cycle ? "D" : "A",
      factors: [],
    },
    stats: {
      packageCount: 4,
      edgeCount: 4,
      externalDependencyCount: 0,
      maxDepth: 2,
      isAcyclic: !opts.cycle,
      orphanCount: 0,
    },
    generatedAt: "T",
  };
}

function check(
  checkId: string,
  status: HealthCheckResult["status"],
  severity: HealthCheckResult["severity"] = "high",
): HealthCheckResult {
  return {
    checkId,
    label: checkId,
    status,
    severity,
    summary: `${checkId} ${status}`,
  };
}

function report(
  p: PackageInfo,
  score: number,
  checks: HealthCheckResult[],
): PackageHealthReport {
  const status = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "pass";
  return {
    package: p,
    checks,
    score,
    confidence: "high",
    status,
    generatedAt: "T",
  };
}

function run(reports: PackageHealthReport[], g: DependencyGraph): WorkbenchRun {
  return {
    id: "run",
    workspace,
    reports,
    summary: summarize(reports),
    startedAt: "T",
    finishedAt: "T",
    graph: g,
  };
}

/** A base snapshot where everything is healthy. */
const baseSnapshot: HistoricalRun = {
  id: "base",
  metadata: {
    runId: "base",
    timestamp: "2026-06-01T00:00:00Z",
    gitBranch: "main",
    workspacePath: ROOT,
  },
  overallScore: 95,
  summary: {
    totalPackages: 4,
    passed: 4,
    warned: 0,
    failed: 0,
    averageScore: 95,
  },
  packages: [
    {
      id: "@nw/core",
      name: "@nw/core",
      score: 95,
      status: "pass",
      failedCheckIds: [],
    },
    {
      id: "@nw/a",
      name: "@nw/a",
      score: 95,
      status: "pass",
      failedCheckIds: [],
    },
    {
      id: "@nw/b",
      name: "@nw/b",
      score: 95,
      status: "pass",
      failedCheckIds: [],
    },
    {
      id: "@nw/app",
      name: "@nw/app",
      score: 95,
      status: "pass",
      failedCheckIds: [],
    },
  ],
  graph: {
    score: 95,
    grade: "A",
    cycleCount: 0,
    violationCount: 0,
    smellCount: 0,
  },
  scenarios: null,
};

// ---- blast radius ------------------------------------------------------------

describe("blast radius", () => {
  it("attributes files to the most specific package", () => {
    const map = attributeFiles(Object.values(PACKAGES), ROOT, [
      "packages/core/src/index.ts",
      "apps/app/main.ts",
      "README.md",
    ]);
    expect(map.get("@nw/core")).toEqual(["packages/core/src/index.ts"]);
    expect(map.get("@nw/app")).toEqual(["apps/app/main.ts"]);
    expect(map.has("@nw/b")).toBe(false); // README is unattributed
  });

  it("finds all transitive dependents of an edited package", () => {
    const impacted = transitiveDependents(graph(), ["@nw/core"]);
    expect([...impacted].sort()).toEqual(["@nw/a", "@nw/app", "@nw/b"]);
  });

  it("computes coverage and per-package fan-out", () => {
    const radius = computeBlastRadius(graph(), ["@nw/core"]);
    expect(radius.edited).toEqual(["@nw/core"]);
    expect(radius.impacted).toEqual(["@nw/a", "@nw/app", "@nw/b"]);
    expect(radius.total).toHaveLength(4);
    expect(radius.coverage).toBe(1); // whole workspace
    expect(radius.byPackage[0]!.id).toBe("@nw/core");
  });

  it("a leaf edit has a tiny blast radius", () => {
    const radius = computeBlastRadius(graph(), ["@nw/app"]);
    expect(radius.impacted).toEqual([]); // nothing depends on the app
    expect(radius.coverage).toBeCloseTo(0.25);
  });

  it("is cycle-safe", () => {
    expect(() =>
      transitiveDependents(graph({ cycle: ["@nw/a", "@nw/core"] }), [
        "@nw/core",
      ]),
    ).not.toThrow();
  });
});

// ---- risk + policy -----------------------------------------------------------

describe("risk + policy", () => {
  it("scores a safe PR low and approves it", () => {
    const head = run(
      [
        report(PACKAGES.app, 95, [check("x", "pass")]),
        report(PACKAGES.core, 95, []),
        report(PACKAGES.a, 95, []),
        report(PACKAGES.b, 95, []),
      ],
      graph(),
    );
    const review = analyzePullRequest({
      base: baseSnapshot,
      head,
      changedFiles: ["apps/app/main.ts"],
      now: () => "T",
    });
    expect(review.risk.level).toBe("low");
    expect(review.decision.recommendation).toBe("approve");
  });

  it("warns on a small regression in a low-centrality package", () => {
    const head = run(
      [
        report(PACKAGES.app, 80, [
          check("required_scripts_present", "fail", "low"),
        ]),
        report(PACKAGES.core, 95, []),
        report(PACKAGES.a, 95, []),
        report(PACKAGES.b, 95, []),
      ],
      graph(),
    );
    const review = analyzePullRequest({
      base: baseSnapshot,
      head,
      changedFiles: ["apps/app/main.ts"],
      now: () => "T",
    });
    expect(review.delta.regressions.length).toBeGreaterThan(0);
    expect(review.decision.recommendation).toBe("warn");
  });

  it("blocks a breaking PR (new cycle + critical failure in a central package)", () => {
    const head = run(
      [
        report(PACKAGES.core, 40, [
          check("runtime_import_check", "fail", "critical"),
        ]),
        report(PACKAGES.a, 95, []),
        report(PACKAGES.b, 95, []),
        report(PACKAGES.app, 95, []),
      ],
      graph({ cycle: ["@nw/core", "@nw/a"] }),
    );
    const review = analyzePullRequest({
      base: baseSnapshot,
      head,
      changedFiles: ["packages/core/src/index.ts"],
      now: () => "T",
    });
    expect(review.decision.recommendation).toBe("block");
    expect(review.decision.blockedBy).toContain("blockOnNewCycle");
    expect(review.decision.blockedBy).toContain("blockOnCriticalFailure");
    expect(
      review.risk.level === "high" || review.risk.level === "critical",
    ).toBe(true);
    expect(review.blastRadius.impacted).toContain("@nw/app"); // central edit ripples
  });

  it("risk rises monotonically from safe → breaking", () => {
    const safe = assessRisk({
      delta: {
        previousId: "p",
        currentId: "c",
        scoreDelta: 0,
        regressions: [],
        improvements: [],
        summary: "",
      },
      blastRadius: computeBlastRadius(graph(), ["@nw/app"]),
      changed: [],
    });
    const breaking = assessRisk({
      delta: {
        previousId: "p",
        currentId: "c",
        scoreDelta: -30,
        regressions: [
          {
            kind: "check:runtime_import_check",
            severity: "critical",
            detail: "x",
          },
        ],
        improvements: [],
        graphDelta: { scoreDelta: -20, newCycles: 1, newViolations: 0 },
        summary: "",
      },
      blastRadius: computeBlastRadius(graph(), ["@nw/core"]),
      changed: analyzeImpact(graph(), Object.values(PACKAGES), ROOT, [
        "packages/core/src/index.ts",
      ]).changed,
    });
    expect(breaking.score).toBeGreaterThan(safe.score);
  });

  it("decideMerge respects a custom policy that disables cycle blocking", () => {
    const head = run(
      [report(PACKAGES.core, 90, [])],
      graph({ cycle: ["@nw/core", "@nw/a"] }),
    );
    const review = analyzePullRequest({
      base: baseSnapshot,
      head,
      policy: {
        ...DEFAULT_MERGE_POLICY,
        blockOnNewCycle: false,
        blockAtRisk: undefined,
      },
      now: () => "T",
    });
    expect(review.decision.blockedBy).not.toContain("blockOnNewCycle");
  });
});

// ---- reporting + github ------------------------------------------------------

describe("report + github", () => {
  const head = run(
    [
      report(PACKAGES.core, 78, [
        check("runtime_import_check", "fail", "critical"),
      ]),
      report(PACKAGES.a, 95, []),
      report(PACKAGES.b, 95, []),
      report(PACKAGES.app, 95, []),
    ],
    graph({ cycle: ["@nw/core", "@nw/a"] }),
  );
  const review = analyzePullRequest({
    base: baseSnapshot,
    head,
    changedFiles: ["packages/core/src/index.ts"],
    baseRef: "main",
    headRef: "pr",
    now: () => "T",
  });

  it("renders the score line and recommendation in markdown", () => {
    const md = renderPrReview(review, "markdown");
    expect(md).toContain(scoreLine(review));
    expect(md).toContain("Block merge");
    expect(md).toContain("Blast radius");
  });

  it("emits json + html", () => {
    expect(() => JSON.parse(renderPrReview(review, "json"))).not.toThrow();
    expect(renderPrReview(review, "html")).toContain("<!doctype html>");
  });

  it("maps a blocked review to a failing GitHub check + annotations", () => {
    expect(githubCheckConclusion(review)).toBe("failure");
    const annotations = githubAnnotations(review, {
      "@nw/core": "packages/core",
    });
    expect(annotations.some((a) => a.startsWith("::error"))).toBe(true);
    expect(
      annotations.some((a) => a.includes("file=packages/core/package.json")),
    ).toBe(true);
  });
});
