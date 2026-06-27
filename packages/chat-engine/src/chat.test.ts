import { describe, expect, it } from "vitest";
import type {
  DependencyGraph,
  HistoricalRun,
  RunDelta,
} from "@package-workbench/plugin-sdk";
import type {
  FixPlan,
  PackageHealthReport,
  RefactorPlan,
  WorkbenchRun,
} from "@package-workbench/core";
import { detectIntent } from "./intent";
import { createChatEngine } from "./engine";
import { LLMChatProvider } from "./provider";
import type { LLMClient, WorkbenchKnowledge } from "./types";

/**
 * A deterministic corpus across the intent families (health, dependency,
 * architecture, regression, refactor, performance) plus conversational memory.
 * The heuristic engine must answer every one offline, grounded in the fixture —
 * no invented facts, always with cited evidence.
 */

function report(
  name: string,
  score: number,
  checks: Array<{ id: string; status: "fail" | "warn"; summary: string }>,
  scenarioFailed = 0,
): PackageHealthReport {
  return {
    package: {
      id: name,
      name,
      version: "1.0.0",
      root: `/repo/${name.split("/").pop()}`,
      runtime: "node",
      packageType: "library",
    },
    checks: checks.map((c) => ({
      checkId: c.id,
      label: c.id,
      status: c.status,
      severity: "high",
      summary: c.summary,
    })),
    score,
    confidence: "high",
    status: score < 60 ? "fail" : score < 80 ? "warn" : "pass",
    generatedAt: "T",
    scenarios: scenarioFailed
      ? {
          failed: scenarioFailed,
          total: 3,
          passed: 3 - scenarioFailed,
          skipped: 0,
          passRate: 0,
          durationMs: 0,
          results: [],
          packageId: name,
        }
      : undefined,
  } as unknown as PackageHealthReport;
}

function node(id: string, fanIn: number, fanOut: number) {
  return {
    id,
    name: id,
    metrics: {
      fanIn,
      fanOut,
      degree: fanIn + fanOut,
      centrality: 0.5,
      depth: 0,
      transitiveDependents: fanIn,
      transitiveDependencies: fanOut,
    },
  };
}

const knowledge = (): WorkbenchKnowledge => {
  const reports = [
    report(
      "@repo/auth",
      62,
      [
        {
          id: "runtime_import_check",
          status: "fail",
          summary: "MISSING_DEPENDENCY: Missing module: zod",
        },
      ],
      2,
    ),
    report("@repo/core", 95, []),
    report("@repo/chart", 88, []),
    report("@repo/app", 90, []),
  ];
  const run = {
    reports,
    summary: {
      totalPackages: 4,
      passed: 2,
      warned: 1,
      failed: 1,
      averageScore: 84,
    },
    workspace: { root: "/repo", name: "repo" },
  } as unknown as WorkbenchRun;

  const graph = {
    nodes: [
      node("@repo/auth", 1, 1),
      node("@repo/core", 1, 1),
      node("@repo/chart", 1, 0),
      node("@repo/app", 0, 2),
    ],
    edges: [
      {
        from: "@repo/app",
        to: "@repo/auth",
        relationships: ["dependency"],
        evidence: [],
        undeclared: false,
      },
      {
        from: "@repo/app",
        to: "@repo/chart",
        relationships: ["dependency"],
        evidence: [],
        undeclared: false,
      },
      {
        from: "@repo/auth",
        to: "@repo/core",
        relationships: ["dependency"],
        evidence: [],
        undeclared: false,
      },
      {
        from: "@repo/core",
        to: "@repo/auth",
        relationships: ["dependency"],
        evidence: [],
        undeclared: false,
      },
    ],
    cycles: [
      {
        cycle: ["@repo/auth", "@repo/core"],
        kind: "indirect",
        severity: "high",
        affected: ["@repo/auth", "@repo/core"],
      },
    ],
    violations: [],
    smells: [],
    health: { score: 70, grade: "C", factors: [] },
    stats: {},
    generatedAt: "T",
  } as unknown as DependencyGraph;

  const refactor = {
    problems: [
      {
        kind: "dependency_cycle",
        packageId: "@repo/auth",
        severity: "high",
        metrics: {},
        evidence: ["Cycle: @repo/auth → @repo/core"],
        detail: "A cycle.",
      },
    ],
    suggestions: [
      {
        id: "s1",
        strategy: "extract_shared_types",
        title: "Break cycle by extracting @repo/core-types",
        targetPackages: ["@repo/auth", "@repo/core"],
        newPackages: ["@repo/core-types"],
        steps: ["Extract shared types", "Re-point both packages"],
        problem: { kind: "dependency_cycle" },
        impact: {
          healthScoreDelta: 12,
          cycleReduction: 1,
          cycleReductionPct: 1,
          fanOutReduction: 0,
          fanOutReductionPct: 0,
          dependencyReduction: 0,
          complexityReduction: 0.5,
          buildImprovement: "",
          rationale: [],
        },
        risk: {
          level: "medium",
          factors: [],
          effort: "medium",
          affectedPackages: 2,
        },
        explanation: {
          why: "auth and core form a cycle",
          howItHelps: "breaks the cycle",
          tradeoffs: [],
          evidence: [],
        },
        visualization: {
          before: { nodes: [], edges: [], cycleCount: 1, healthScore: 70 },
          after: { nodes: [], edges: [], cycleCount: 0, healthScore: 82 },
          changedEdges: [],
          changedNodes: [],
        },
        score: 10,
      },
    ],
    summary: "",
    variant: 0,
    generatedAt: "T",
  } as unknown as RefactorPlan;

  const intel = {
    inventories: [],
    usage: [],
    sizes: [
      {
        packageId: "@repo/chart",
        packageName: "@repo/chart",
        measured: true,
        totalBytes: 600 * 1024,
        fileCount: 5,
        largestFiles: [],
        heavyClientDeps: [],
      },
    ],
    dependencyWeight: [],
    duplicateVersions: [],
    generatedAt: "T",
  } as unknown as WorkbenchKnowledge["intel"];

  const history = [
    {
      id: "r2",
      metadata: {},
      overallScore: 84,
      summary: {},
      packages: [
        {
          id: "@repo/auth",
          name: "@repo/auth",
          score: 62,
          status: "fail",
          failedCheckIds: ["runtime_import_check"],
        },
      ],
    },
    {
      id: "r1",
      metadata: {},
      overallScore: 90,
      summary: {},
      packages: [
        {
          id: "@repo/auth",
          name: "@repo/auth",
          score: 70,
          status: "fail",
          failedCheckIds: ["runtime_import_check"],
        },
      ],
    },
  ] as unknown as HistoricalRun[];

  const delta = {
    previousId: "r1",
    currentId: "r2",
    scoreDelta: -8,
    regressions: [
      {
        kind: "check:runtime_import_check",
        severity: "critical",
        packageId: "@repo/auth",
        detail: "@repo/auth: runtime import now fails",
      },
    ],
    improvements: [],
    summary: "",
  } as unknown as RunDelta;

  const fixPlan = {
    candidates: [
      {
        id: "f1",
        kind: "add_missing_dependency",
        safety: "safe",
        title: "Add dependency",
        problem: "Missing dependency: zod",
        description: 'Add "zod": "^3.22.4" to dependencies',
        packageId: "@repo/auth",
        patches: [],
        evidence: [],
      },
    ],
    summary: { safe: 1, reviewRequired: 0, dangerous: 0 },
    generatedAt: "T",
  } as unknown as FixPlan;

  return { run, graph, intel, refactor, history, delta, fixPlan };
};

// ---- intent detection --------------------------------------------------------

describe("detectIntent", () => {
  const k = knowledge();
  const cases: Array<[string, string]> = [
    ["Why is auth unhealthy?", "failure"],
    ["Which packages depend on @repo/chart?", "dependency"],
    ["What should I refactor first?", "refactor"],
    ["Why did the score drop?", "regression"],
    ["Which package is causing CI instability?", "regression"],
    ["What changed since last week?", "regression"],
    ["Which package is the largest?", "performance"],
    ["Where is coupling too high?", "architecture"],
  ];
  for (const [q, expected] of cases) {
    it(`classifies "${q}" as ${expected}`, () => {
      expect(detectIntent(q, k).type).toBe(expected);
    });
  }

  it("extracts package entities from the question", () => {
    expect(detectIntent("Why is @repo/auth unhealthy?", k).entities).toContain(
      "@repo/auth",
    );
    expect(detectIntent("Why is auth unhealthy?", k).entities).toContain(
      "@repo/auth",
    );
  });
});

// ---- heuristic answers -------------------------------------------------------

describe("heuristic chat answers", () => {
  it("explains why a package is unhealthy with evidence + actions", async () => {
    const engine = createChatEngine(knowledge());
    const { answer } = await engine.ask("Why is auth unhealthy?");
    expect(answer.intent).toBe("failure");
    expect(answer.answer).toContain("62");
    expect(answer.evidence.length).toBeGreaterThan(0);
    expect(answer.evidence.some((e) => /zod/.test(e.text))).toBe(true);
    expect(answer.suggestedActions.some((a) => /zod/.test(a.title))).toBe(true);
    expect(answer.confidence).toBe("high");
    expect(answer.references).toContain("@repo/auth");
  });

  it("answers what depends on a package from the graph", async () => {
    const { answer } = await createChatEngine(knowledge()).ask(
      "Which packages depend on @repo/auth?",
    );
    expect(answer.intent).toBe("dependency");
    expect(answer.answer).toContain("@repo/app"); // app depends on auth
    expect(answer.confidence).toBe("high");
  });

  it("recommends the top refactor first", async () => {
    const { answer } = await createChatEngine(knowledge()).ask(
      "What should I refactor first?",
    );
    expect(answer.intent).toBe("refactor");
    expect(answer.answer).toContain("Break cycle");
    expect(answer.suggestedActions.length).toBeGreaterThan(0);
  });

  it("explains a score drop from the delta", async () => {
    const { answer } = await createChatEngine(knowledge()).ask(
      "Why did the score drop?",
    );
    expect(answer.intent).toBe("regression");
    expect(answer.answer).toContain("-8");
    expect(answer.evidence.some((e) => e.source === "history")).toBe(true);
  });

  it("identifies the most CI-unstable package from history", async () => {
    // Remove the delta so it falls back to history-based flakiness.
    const k = knowledge();
    k.delta = null;
    const { answer } = await createChatEngine(k).ask(
      "Which package is causing CI instability?",
    );
    expect(answer.answer).toContain("@repo/auth");
  });

  it("names the largest package from intel", async () => {
    const { answer } = await createChatEngine(knowledge()).ask(
      "Which package is the largest?",
    );
    expect(answer.intent).toBe("performance");
    expect(answer.answer).toContain("@repo/chart");
  });

  it("never invents data: a regression question with no history is low-confidence", async () => {
    const k = knowledge();
    k.delta = null;
    k.history = [];
    const { answer } = await createChatEngine(k).ask("Why did the score drop?");
    expect(answer.confidence).toBe("low");
    expect(answer.evidence).toHaveLength(0);
  });
});

// ---- conversational memory ---------------------------------------------------

describe("conversational memory", () => {
  it("reuses the prior focus for a follow-up without a subject", async () => {
    const engine = createChatEngine(knowledge());
    const first = await engine.ask("Why is auth unhealthy?");
    expect(first.session.focusEntities).toContain("@repo/auth");
    // Follow-up names no package — should reuse auth.
    const second = await engine.ask("what depends on it?", first.session);
    expect(second.answer.intent).toBe("dependency");
    expect(second.answer.references).toContain("@repo/auth");
  });
});

// ---- LLM provider (optional) -------------------------------------------------

describe("LLMChatProvider", () => {
  it("refines prose but keeps evidence/confidence, and falls back on error", async () => {
    const good: LLMClient = {
      id: "mock",
      complete: async () =>
        '{"answer":"Auth is unhealthy because zod is missing."}',
    };
    const refined = await createChatEngine(knowledge(), {
      provider: new LLMChatProvider(good),
    }).ask("Why is auth unhealthy?");
    expect(refined.answer.answer).toBe(
      "Auth is unhealthy because zod is missing.",
    );
    expect(refined.answer.confidence).toBe("high"); // unchanged by the model
    expect(refined.answer.provider).toBe("llm:mock");

    const failing: LLMClient = {
      id: "x",
      complete: async () => {
        throw new Error("offline");
      },
    };
    const fallback = await createChatEngine(knowledge(), {
      provider: new LLMChatProvider(failing),
    }).ask("Why is auth unhealthy?");
    expect(fallback.answer.answer).toContain("62"); // heuristic baseline preserved
  });
});
