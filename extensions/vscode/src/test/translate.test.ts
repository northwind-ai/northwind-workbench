import { describe, expect, it } from "vitest";
import type {
  DependencyGraph,
  FixPlan,
  HealthCheckResult,
  PackageHealthReport,
  WorkbenchRun,
} from "@package-workbench/core";
import {
  diagnosticsForPackageJson,
  extractImportSpecifier,
  findKeyRange,
  fixesForFile,
  hoverCardForPackage,
  packageForFile,
  packageForSpecifier,
  renderHoverMarkdown,
  severityForCheck,
} from "../translate";

/**
 * The extension's translation layer is its only logic worth testing without a
 * live editor — so it's pure and verified here. Core types are imported type-only
 * (erased at runtime); fixtures are built inline. Deterministic, offline.
 */

function check(
  checkId: string,
  status: HealthCheckResult["status"],
  severity: HealthCheckResult["severity"] = "high",
  extra: Partial<HealthCheckResult> = {},
): HealthCheckResult {
  return {
    checkId,
    label: checkId,
    status,
    severity,
    summary: `${checkId} ${status}`,
    ...extra,
  };
}

function report(
  name: string,
  root: string,
  score: number,
  checks: HealthCheckResult[],
): PackageHealthReport {
  return {
    package: {
      id: name,
      name,
      version: "1.0.0",
      root,
      packageJsonPath: `${root}/package.json`,
      private: false,
      packageType: "library",
      runtime: "node",
      scripts: {},
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
      manifest: {},
      manifestValid: true,
      warnings: [],
    },
    checks,
    score,
    confidence: "high",
    status: checks.some((c) => c.status === "fail") ? "fail" : "pass",
    generatedAt: "T",
  };
}

function run(reports: PackageHealthReport[]): WorkbenchRun {
  return {
    id: "r",
    workspace: { root: "/repo" } as WorkbenchRun["workspace"],
    reports,
    summary: {} as WorkbenchRun["summary"],
    startedAt: "T",
    finishedAt: "T",
  };
}

const graph = (over: Partial<DependencyGraph> = {}): DependencyGraph =>
  ({
    nodes: [],
    edges: [],
    cycles: [],
    violations: [],
    smells: [],
    health: { score: 90, grade: "A", factors: [] },
    stats: {} as DependencyGraph["stats"],
    generatedAt: "T",
    ...over,
  }) as DependencyGraph;

// ---- resolution --------------------------------------------------------------

describe("package + specifier resolution", () => {
  it("resolves a file to its most specific package", () => {
    const r = run([
      report("@repo/a", "/repo/packages/a", 80, []),
      report("@repo/a-nested", "/repo/packages/a/nested", 70, []),
    ]);
    expect(
      packageForFile(r, "/repo/packages/a/nested/src/x.ts")?.package.name,
    ).toBe("@repo/a-nested");
    expect(packageForFile(r, "/repo/packages/a/src/y.ts")?.package.name).toBe(
      "@repo/a",
    );
  });

  it("resolves an import specifier (incl. subpaths) to a package", () => {
    const r = run([report("@repo/core", "/repo/packages/core", 80, [])]);
    expect(packageForSpecifier(r, "@repo/core")?.package.name).toBe(
      "@repo/core",
    );
    expect(packageForSpecifier(r, "@repo/core/sub")?.package.name).toBe(
      "@repo/core",
    );
    expect(packageForSpecifier(r, "lodash")).toBeNull();
  });

  it("extracts import specifiers from various forms", () => {
    expect(extractImportSpecifier(`import { x } from "@repo/core"`)).toBe(
      "@repo/core",
    );
    expect(extractImportSpecifier(`const a = require('@repo/util')`)).toBe(
      "@repo/util",
    );
    expect(extractImportSpecifier(`const m = await import('@repo/lazy')`)).toBe(
      "@repo/lazy",
    );
    expect(extractImportSpecifier(`const x = 1`)).toBeNull();
  });
});

// ---- ranges + severity -------------------------------------------------------

describe("ranges + severity", () => {
  it("finds a key range with correct line/column", () => {
    const text = '{\n  "name": "x",\n  "react-dom": "^18"\n}';
    const range = findKeyRange(text, "react-dom");
    expect(range).toEqual({
      startLine: 2,
      startCol: 2,
      endLine: 2,
      endCol: 2 + '"react-dom"'.length,
    });
  });

  it("maps check status/severity to editor severity", () => {
    expect(severityForCheck({ status: "fail", severity: "critical" })).toBe(
      "error",
    );
    expect(severityForCheck({ status: "fail", severity: "high" })).toBe(
      "warning",
    );
    expect(severityForCheck({ status: "warn", severity: "low" })).toBe(
      "warning",
    );
    expect(severityForCheck({ status: "pass", severity: "info" })).toBe("info");
  });
});

// ---- diagnostics -------------------------------------------------------------

describe("diagnosticsForPackageJson", () => {
  const text = '{\n  "name": "@repo/auth",\n  "peerDependencies": {}\n}';

  it("surfaces a missing peer dependency with its name", () => {
    const r = report("@repo/auth", "/repo/packages/auth", 70, [
      check("missing_peer_dependencies", "warn", "high", {
        evidence: ["react-dom@^18"],
      }),
    ]);
    const diags = diagnosticsForPackageJson(
      r,
      undefined,
      text,
      "/repo/packages/auth/package.json",
    );
    const peer = diags.find((d) => d.code === "missing_peer_dependencies");
    expect(peer?.severity).toBe("warning");
    expect(peer?.message).toContain("react-dom");
  });

  it("surfaces a circular dependency involving the package", () => {
    const r = report("@repo/core", "/repo/packages/core", 60, []);
    const g = graph({
      cycles: [
        {
          cycle: ["@repo/core", "@repo/auth"],
          kind: "indirect",
          severity: "high",
          affected: ["@repo/core", "@repo/auth"],
        },
      ],
    });
    const diags = diagnosticsForPackageJson(
      r,
      g,
      '{\n  "name": "@repo/core"\n}',
      "/repo/packages/core/package.json",
    );
    const cyc = diags.find((d) => d.code === "circular_dependency");
    expect(cyc?.message).toContain("@repo/auth");
  });

  it("surfaces a boundary violation from this package", () => {
    const r = report("@repo/ui", "/repo/packages/ui", 70, []);
    const g = graph({
      violations: [
        {
          from: "@repo/ui",
          to: "@repo/db",
          rule: "ui-cannot-use-db",
          severity: "high",
          relationships: ["dependency"],
        },
      ],
    });
    const diags = diagnosticsForPackageJson(
      r,
      g,
      '{ "name": "@repo/ui" }',
      "/repo/packages/ui/package.json",
    );
    expect(
      diags.some(
        (d) =>
          d.code === "boundary_violation" && d.message.includes("@repo/db"),
      ),
    ).toBe(true);
  });
});

// ---- hover -------------------------------------------------------------------

describe("hover card", () => {
  it("summarizes health, runtime, and warnings (incl. cycles)", () => {
    const r = report("@repo/core", "/repo/packages/core", 72, [
      check("missing_peer_dependencies", "warn", "high", {
        evidence: ["react-dom@^18"],
      }),
    ]);
    const g = graph({
      cycles: [
        {
          cycle: ["@repo/core", "@repo/auth"],
          kind: "indirect",
          severity: "high",
          affected: ["@repo/core"],
        },
      ],
    });
    const card = hoverCardForPackage(r, g);
    expect(card.health).toBe(72);
    expect(card.runtime).toBe("node");
    expect(card.warnings.some((w) => w.includes("cycle"))).toBe(true);
    const md = renderHoverMarkdown(card);
    expect(md).toContain("@repo/core");
    expect(md).toContain("72/100");
  });
});

// ---- quick fixes -------------------------------------------------------------

describe("fixesForFile", () => {
  it("returns fixes whose patches touch the file, excluding dangerous", () => {
    const plan: FixPlan = {
      candidates: [
        {
          id: "a",
          kind: "add_missing_dependency",
          safety: "safe",
          title: "Add dep",
          problem: "x",
          description: "x",
          patches: [
            {
              path: "/repo/packages/a/package.json",
              before: "{}",
              after: "{}",
            },
          ],
          evidence: [],
        },
        {
          id: "b",
          kind: "architecture_refactor",
          safety: "dangerous",
          title: "Split",
          problem: "x",
          description: "x",
          patches: [
            {
              path: "/repo/packages/a/package.json",
              before: "{}",
              after: "{}",
            },
          ],
          evidence: [],
        },
        {
          id: "c",
          kind: "add_missing_field",
          safety: "safe",
          title: "Other",
          problem: "x",
          description: "x",
          patches: [
            {
              path: "/repo/packages/b/package.json",
              before: "{}",
              after: "{}",
            },
          ],
          evidence: [],
        },
      ],
      summary: { safe: 2, reviewRequired: 0, dangerous: 1 },
      generatedAt: "T",
    };
    const fixes = fixesForFile(plan, "/repo/packages/a/package.json");
    expect(fixes.map((f) => f.id)).toEqual(["a"]); // not the dangerous one, not the other file
  });
});
