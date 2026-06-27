import {
  assemblePackageInfo,
  emptyRuntimeMatrix,
  scoreToGrade,
  type DependencyGraph,
  type DependencyNode,
  type HealthCheckResult,
  type NodeMetrics,
  type PackageInfo,
  type PackageManifest,
  type RuntimeCompatibilityReport,
  type ScenarioRunResult,
  type WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import type { PackageHealthReport, WorkbenchRun } from "./types";
import { CheckId } from "./check-ids";
import { buildReport, summarize } from "./scoring";

/**
 * Deterministic mock run. No filesystem access, no randomness — used by the
 * desktop app on first launch and by `pw scan --mock`, shared verbatim by both
 * so the UI and CLI render identical data. Demonstrates every interesting state,
 * including a runtime matrix and a scenario run.
 */

const AT = "2020-01-01T00:00:00.000Z";

function pkg(name: string, manifest: Partial<PackageManifest>): PackageInfo {
  const dir = name.replace(/^@[^/]+\//, "");
  const root = `/workspace/packages/${dir}`;
  return assemblePackageInfo({
    root,
    packageJsonPath: `${root}/package.json`,
    manifest: { name, version: "1.0.0", ...manifest },
  });
}

function res(
  checkId: string,
  label: string,
  status: HealthCheckResult["status"],
  severity: HealthCheckResult["severity"],
  summary: string,
  extra: Partial<HealthCheckResult> = {},
): HealthCheckResult {
  return { checkId, label, status, severity, summary, ...extra };
}

const runtimeChecks = (
  variant: "healthy" | "esm-broken" | "na",
): HealthCheckResult[] => {
  if (variant === "na") {
    return [
      res(
        CheckId.moduleResolution,
        "Declared modules resolve",
        "unknown",
        "medium",
        "Could not evaluate (invalid manifest)",
      ),
      res(
        CheckId.exportsMap,
        "exports map is valid",
        "skip",
        "info",
        'No "exports" map declared',
      ),
      res(
        CheckId.browserCompatibility,
        "Browser compatibility",
        "skip",
        "info",
        "No Node built-ins used",
      ),
      res(
        CheckId.runtimeImport,
        "Module can be imported",
        "skip",
        "info",
        "No entry resolves — build the package, then re-check",
      ),
      res(
        CheckId.scenarioRunner,
        "Scenarios pass",
        "skip",
        "info",
        "No scenarios contributed for this package",
      ),
    ];
  }
  if (variant === "esm-broken") {
    return [
      res(
        CheckId.moduleResolution,
        "Declared modules resolve",
        "fail",
        "high",
        "1/1 declared target(s) do not resolve",
        {
          evidence: [
            './dist/index.js — "main" points at a file that does not exist',
          ],
        },
      ),
      res(
        CheckId.exportsMap,
        "exports map is valid",
        "fail",
        "high",
        "Invalid exports/entry configuration (1 issue)",
        {
          evidence: [".: Declared target does not exist: ./dist/index.js"],
        },
      ),
      res(
        CheckId.browserCompatibility,
        "Browser compatibility",
        "skip",
        "info",
        "No Node built-ins used (browser not an intended target)",
      ),
      res(
        CheckId.runtimeImport,
        "Module can be imported",
        "skip",
        "info",
        "No ESM entry resolves — build the package, then re-check",
      ),
      res(
        CheckId.scenarioRunner,
        "Scenarios pass",
        "skip",
        "info",
        "1 scenario available — run `package-workbench scenarios` to execute",
      ),
    ];
  }
  return [
    res(
      CheckId.moduleResolution,
      "Declared modules resolve",
      "pass",
      "high",
      "2/2 declared target(s) resolve",
    ),
    res(
      CheckId.exportsMap,
      "exports map is valid",
      "pass",
      "high",
      "exports map is structurally valid",
    ),
    res(
      CheckId.browserCompatibility,
      "Browser compatibility",
      "skip",
      "info",
      "No Node built-ins used (browser not an intended target)",
    ),
    res(
      CheckId.runtimeImport,
      "Module can be imported",
      "pass",
      "high",
      "Imported as ESM — 2 export(s) in 41ms",
    ),
    res(
      CheckId.scenarioRunner,
      "Scenarios pass",
      "pass",
      "high",
      "2/2 scenarios passed (100%)",
    ),
  ];
};

const goodChecks = (): HealthCheckResult[] => [
  res(
    CheckId.packageJsonValid,
    "package.json is valid",
    "pass",
    "critical",
    "package.json parsed successfully",
  ),
  res(
    CheckId.packageNamePresent,
    "Package has a name",
    "pass",
    "high",
    "Named",
  ),
  res(
    CheckId.entrypointExists,
    "Has a resolvable entry point",
    "pass",
    "high",
    "Entry resolves",
  ),
  res(
    CheckId.mainModuleExists,
    '"main"/"module" file exists',
    "pass",
    "high",
    "Module target resolves",
  ),
  res(
    CheckId.typesEntryExists,
    "Type declarations exist",
    "pass",
    "medium",
    "Types resolve",
  ),
  res(
    CheckId.missingPeerDependencies,
    "Peer dependencies resolvable",
    "pass",
    "high",
    "All peers resolvable",
  ),
  res(
    CheckId.requiredScriptsPresent,
    "Common scripts present",
    "pass",
    "low",
    "4/4 common scripts present",
  ),
  res(
    CheckId.dependencyVersionShape,
    "Dependency versions well-formed",
    "pass",
    "low",
    "Specifiers look valid",
  ),
  ...runtimeChecks("healthy"),
];

/** A demo runtime matrix for the healthy library. */
function demoRuntime(packageId: string): RuntimeCompatibilityReport {
  return {
    packageId,
    matrix: {
      ...emptyRuntimeMatrix(),
      node_esm: "pass",
      node_cjs: "pass",
      browser: "warn",
      electron_main: "pass",
      electron_renderer: "warn",
    },
    targets: [
      {
        target: "node_cjs",
        status: "pass",
        intended: true,
        reason: "Imported successfully (2 export(s))",
      },
      {
        target: "node_esm",
        status: "pass",
        intended: true,
        reason: "Imported successfully (2 export(s))",
      },
      {
        target: "browser",
        status: "warn",
        intended: true,
        reason:
          "Uses polyfillable Node built-ins (path) — needs a bundler shim",
      },
      {
        target: "electron_renderer",
        status: "warn",
        intended: false,
        reason: "Mirrors browser result (warn)",
      },
      {
        target: "electron_main",
        status: "pass",
        intended: false,
        reason: "Electron main runs Node — mirrors Node result (pass)",
      },
    ],
    detection: {
      primary: "universal",
      intended: ["node_esm", "node_cjs", "browser"],
      confidence: 0.78,
      signals: [
        {
          source: "exports",
          points: "browser",
          weight: 4,
          detail: 'exports has a "browser" condition',
        },
        {
          source: "engines",
          points: "node",
          weight: 2,
          detail: "engines.node >=18",
        },
      ],
    },
    nodeBuiltinsUsed: ["path"],
    resolution: [
      {
        specifier: "./dist/index.js",
        resolved: true,
        resolvedPath: "/workspace/packages/core/dist/index.js",
        format: "esm",
      },
    ],
    generatedAt: AT,
  };
}

/** A demo scenario run for the healthy library. */
function demoScenarios(packageId: string): ScenarioRunResult {
  return {
    packageId,
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    passRate: 1,
    durationMs: 88,
    results: [
      {
        id: "typescript:module-loads",
        title: "Module loads and exposes exports",
        status: "pass",
        durationMs: 53,
        assertions: [],
        logs: ["Importing /workspace/packages/core/dist/index.js as esm"],
      },
      {
        id: "basic-runtime",
        title: "Basic runtime works",
        status: "pass",
        durationMs: 35,
        assertions: [],
        logs: [],
      },
    ],
  };
}

/** A small demo dependency graph (with one cycle) for first-launch. */
function demoGraph(): DependencyGraph {
  const m = (fanIn: number, fanOut: number, depth: number): NodeMetrics => ({
    fanIn,
    fanOut,
    degree: fanIn + fanOut,
    centrality: Math.round(((fanIn + fanOut) / 6) * 100) / 100,
    depth,
    transitiveDependents: fanIn,
    transitiveDependencies: fanOut,
  });
  const mk = (
    name: string,
    layer: number,
    type: DependencyNode["packageType"],
    metrics: NodeMetrics,
    isOrphan = false,
  ): DependencyNode => ({
    id: name,
    name,
    version: "1.0.0",
    root: `/workspace/packages/${name.replace(/^@[^/]+\//, "")}`,
    packageType: type,
    runtime: "universal",
    layer,
    tags: [type],
    isOrphan,
    metrics,
  });
  const nodes = [
    mk("@acme/app", 3, "app", m(0, 3, 3)),
    mk("@acme/ui", 1, "library", m(1, 2, 2)),
    mk("@acme/core", 1, "library", m(3, 1, 1)),
    mk("@acme/auth", 1, "library", m(1, 1, 2)),
  ];
  const edge = (
    from: string,
    to: string,
    undeclared = false,
  ): DependencyGraph["edges"][number] => ({
    from,
    to,
    relationships: ["dependency"],
    evidence: [],
    undeclared,
  });
  const edges = [
    edge("@acme/app", "@acme/ui"),
    edge("@acme/app", "@acme/core"),
    edge("@acme/app", "@acme/auth"),
    edge("@acme/ui", "@acme/core"),
    edge("@acme/auth", "@acme/core"),
    edge("@acme/core", "@acme/auth", true), // creates a core↔auth cycle
  ];
  return {
    nodes,
    edges,
    cycles: [
      {
        cycle: ["@acme/core", "@acme/auth"],
        kind: "direct",
        severity: "high",
        affected: ["@acme/auth", "@acme/core"],
      },
    ],
    violations: [
      {
        from: "@acme/core",
        to: "@acme/auth",
        rule: "core must not depend on feature packages",
        severity: "high",
        relationships: ["import"],
      },
    ],
    smells: [
      {
        kind: "god_package",
        packageId: "@acme/core",
        severity: "medium",
        detail: "3 packages depend on this",
        metric: 3,
      },
    ],
    health: {
      score: 73,
      grade: scoreToGrade(73),
      factors: [
        { label: "Circular dependencies", penalty: 15, detail: "1 cycle(s)" },
        {
          label: "Boundary violations",
          penalty: 12,
          detail: "1 rule break(s)",
        },
      ],
    },
    stats: {
      packageCount: 4,
      edgeCount: 6,
      externalDependencyCount: 5,
      maxDepth: 3,
      isAcyclic: false,
      orphanCount: 0,
    },
    generatedAt: AT,
  };
}

export function createMockRun(): WorkbenchRun {
  const workspace: WorkspaceInfo = {
    root: "/workspace",
    name: "demo-workspace",
    packageManager: "pnpm",
    isMonorepo: true,
    packageCount: 4,
    tooling: {
      packageJson: true,
      pnpmWorkspace: true,
      nx: false,
      turbo: false,
      tsconfigBase: true,
    },
    warnings: [],
  };

  const definitions: Array<{
    pkg: PackageInfo;
    checks: HealthCheckResult[];
    withRuntime?: boolean;
  }> = [
    // 1. Healthy library — with a runtime matrix + scenarios attached.
    {
      pkg: pkg("@acme/core", {
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        scripts: { build: "tsup", test: "vitest" },
      }),
      checks: goodChecks(),
      withRuntime: true,
    },

    // 2. Missing peer dependency (warning) + browser UI lib.
    {
      pkg: pkg("@acme/ui", {
        main: "dist/index.js",
        peerDependencies: { react: "^18", "react-dom": "^18" },
        dependencies: { react: "^18.3.1" },
      }),
      checks: [
        ...goodChecks().slice(0, 5),
        res(
          CheckId.missingPeerDependencies,
          "Peer dependencies resolvable",
          "warn",
          "high",
          "1 required peer not resolvable",
          {
            details:
              "Install these where the package is consumed, or they will fail at runtime.",
            evidence: ["react-dom@^18"],
          },
        ),
        res(
          CheckId.requiredScriptsPresent,
          "Common scripts present",
          "warn",
          "low",
          "Library is missing build and/or test script",
          {
            details: "present: none · absent: build, test, typecheck, lint",
          },
        ),
        res(
          CheckId.dependencyVersionShape,
          "Dependency versions well-formed",
          "pass",
          "low",
          "Specifiers look valid",
        ),
        ...runtimeChecks("healthy"),
      ],
    },

    // 3. Entry point failure (critical) — build never emitted the file.
    {
      pkg: pkg("@acme/client", {
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
      }),
      checks: [
        res(
          CheckId.packageJsonValid,
          "package.json is valid",
          "pass",
          "critical",
          "package.json parsed successfully",
        ),
        res(
          CheckId.packageNamePresent,
          "Package has a name",
          "pass",
          "high",
          'Named "@acme/client"',
        ),
        res(
          CheckId.entrypointExists,
          "Has a resolvable entry point",
          "fail",
          "high",
          "No declared entry point resolves on disk",
          {
            details:
              "Every declared entry points at a file that does not exist (build not run?).",
            evidence: ["dist/index.js"],
          },
        ),
        res(
          CheckId.mainModuleExists,
          '"main"/"module" file exists',
          "fail",
          "high",
          "1/1 module target(s) missing",
          {
            evidence: ["main: dist/index.js"],
          },
        ),
        res(
          CheckId.typesEntryExists,
          "Type declarations exist",
          "fail",
          "medium",
          "Declared types file missing: dist/index.d.ts",
        ),
        ...runtimeChecks("esm-broken"),
        res(
          CheckId.missingPeerDependencies,
          "Peer dependencies resolvable",
          "skip",
          "info",
          "No peer dependencies declared",
        ),
        res(
          CheckId.requiredScriptsPresent,
          "Common scripts present",
          "warn",
          "low",
          "Library is missing build and/or test script",
        ),
        res(
          CheckId.dependencyVersionShape,
          "Dependency versions well-formed",
          "skip",
          "info",
          "No dependencies declared",
        ),
      ],
    },

    // 4. Malformed package.json + unknown signal.
    {
      pkg: assemblePackageInfo({
        root: "/workspace/packages/legacy",
        packageJsonPath: "/workspace/packages/legacy/package.json",
        manifest: {},
        manifestValid: false,
        warnings: [
          "Invalid JSON in package.json: Unexpected token } in JSON at position 42",
        ],
        fallbackName: "legacy",
      }),
      checks: [
        res(
          CheckId.packageJsonValid,
          "package.json is valid",
          "fail",
          "critical",
          "package.json is missing or invalid",
          {
            evidence: [
              "Invalid JSON in package.json: Unexpected token } in JSON at position 42",
            ],
          },
        ),
        res(
          CheckId.packageNamePresent,
          "Package has a name",
          "fail",
          "high",
          'Missing "name" field',
        ),
        res(
          CheckId.entrypointExists,
          "Has a resolvable entry point",
          "unknown",
          "medium",
          "Could not evaluate (invalid manifest)",
        ),
        res(
          CheckId.mainModuleExists,
          '"main"/"module" file exists',
          "skip",
          "info",
          'No "main" or "module" field declared',
        ),
        res(
          CheckId.typesEntryExists,
          "Type declarations exist",
          "skip",
          "info",
          'No "types"/"typings" field declared',
        ),
        ...runtimeChecks("na"),
        res(
          CheckId.missingPeerDependencies,
          "Peer dependencies resolvable",
          "skip",
          "info",
          "No peer dependencies declared",
        ),
        res(
          CheckId.requiredScriptsPresent,
          "Common scripts present",
          "warn",
          "low",
          "No common scripts defined",
        ),
        res(
          CheckId.dependencyVersionShape,
          "Dependency versions well-formed",
          "skip",
          "info",
          "No dependencies declared",
        ),
      ],
    },
  ];

  const reports: PackageHealthReport[] = definitions.map((d) => {
    const report = buildReport(d.pkg, d.checks, AT);
    if (d.withRuntime) {
      report.runtime = demoRuntime(d.pkg.id);
      report.scenarios = demoScenarios(d.pkg.id);
    }
    return report;
  });

  return {
    id: "mock-run",
    workspace,
    reports,
    summary: summarize(reports),
    startedAt: AT,
    finishedAt: AT,
    graph: demoGraph(),
  };
}
