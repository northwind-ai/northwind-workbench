import { describe, expect, it } from "vitest";
import {
  assemblePackageInfo,
  type PackageManifest,
} from "@package-workbench/plugin-sdk";
import { classifyPackage } from "./classify";
import {
  scanDebt,
  determineActivity,
  estimateCoverage,
  scoreDebt,
  type SourceLike,
} from "./debt";

/**
 * Pure-function fixtures: dead/stale packages, an incomplete feature, a TODO-heavy
 * file, and mock leakage. Deterministic; conservative classification is asserted
 * (no false positives).
 */

function pkg(
  name: string,
  manifest: Partial<PackageManifest> = {},
  root = `/repo/packages/${name.split("/").pop()}`,
) {
  return assemblePackageInfo({
    root,
    packageJsonPath: `${root}/package.json`,
    manifest: { name, version: "1.0.0", ...manifest },
  });
}
const file = (rel: string, content: string): SourceLike => ({
  rel,
  content,
  isTest: /\.(test|spec)\./.test(rel),
});

// ---- classification ----------------------------------------------------------

describe("classifyPackage", () => {
  it("classifies by manifest + name signals with confidence", () => {
    expect(
      classifyPackage(pkg("@r/cli", { bin: { r: "index.js" } })).class,
    ).toBe("cli");
    expect(classifyPackage(pkg("eslint-config-r")).class).toBe("config");
    expect(
      classifyPackage(pkg("@r/foo-plugin", { keywords: ["plugin"] })).class,
    ).toBe("plugin");
    expect(
      classifyPackage(
        pkg(
          "@r/web",
          { private: true, scripts: { dev: "vite" } },
          "/repo/apps/web",
        ),
      ).class,
    ).toBe("app");
    expect(classifyPackage(pkg("@r/lib", { main: "index.js" })).class).toBe(
      "library",
    );
    expect(classifyPackage(pkg("@r/poc-thing")).class).toBe("experimental");
    expect(
      classifyPackage(pkg("@r/old-thing", { deprecated: true } as never)).class,
    ).toBe("deprecated");
    expect(classifyPackage(pkg("@r/mystery")).confidence).toBeLessThan(0.5);
  });
});

// ---- debt scanning -----------------------------------------------------------

describe("scanDebt", () => {
  it("finds TODO/FIXME/HACK markers only in comments", () => {
    const findings = scanDebt([
      file(
        "a.ts",
        '// TODO: refactor this\nconst todo = "not a marker";\n/* FIXME: broken */\n// HACK around the bug',
      ),
    ]);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain("todo");
    expect(kinds).toContain("fixme");
    expect(kinds).toContain("hack");
    // The string literal `todo` is not a comment marker.
    expect(findings.filter((f) => f.kind === "todo")).toHaveLength(1);
  });

  it("flags an incomplete feature (throws not implemented)", () => {
    const findings = scanDebt([
      file(
        "a.ts",
        'export function f() {\n  throw new Error("Not implemented yet");\n}',
      ),
    ]);
    expect(
      findings.some(
        (f) => f.kind === "not_implemented" && f.severity === "high",
      ),
    ).toBe(true);
  });

  it("flags mock leakage in production code but not in tests", () => {
    expect(
      scanDebt([file("prod.ts", "const x = mockData.users;")]).some(
        (f) => f.kind === "mock_leakage",
      ),
    ).toBe(true);
    expect(
      scanDebt([file("a.test.ts", "const x = mockData.users;")]).some(
        (f) => f.kind === "mock_leakage",
      ),
    ).toBe(false);
  });
});

// ---- activity (conservative dead) --------------------------------------------

describe("determineActivity", () => {
  it("marks a recently-changed or heavily-depended package active", () => {
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 0,
        ageDays: 5,
        private: true,
      }),
    ).toBe("active");
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 9,
        ageDays: 400,
        private: true,
      }),
    ).toBe("active");
  });

  it("only marks dead when private + no dependents + very old (conservative)", () => {
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 0,
        ageDays: 400,
        private: true,
      }),
    ).toBe("dead");
    // Public package with no recent activity is NOT dead.
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 0,
        ageDays: 400,
        private: false,
      }),
    ).not.toBe("dead");
    // Has a dependent → never dead.
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 1,
        ageDays: 999,
        private: true,
      }),
    ).not.toBe("dead");
  });

  it("marks stale / dormant / deprecated appropriately", () => {
    expect(
      determineActivity({
        isDeprecated: true,
        dependentCount: 5,
        ageDays: 1,
        private: false,
      }),
    ).toBe("deprecated");
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 0,
        ageDays: 200,
        private: false,
      }),
    ).toBe("dormant");
    expect(
      determineActivity({
        isDeprecated: false,
        dependentCount: 1,
        ageDays: 100,
        private: true,
      }),
    ).toBe("stale");
  });
});

// ---- coverage + scoring ------------------------------------------------------

describe("coverage + debt score", () => {
  it("estimates coverage levels", () => {
    expect(estimateCoverage(0, 5, 0)).toBe("none");
    expect(estimateCoverage(1, 10, 0)).toBe("low");
    expect(estimateCoverage(3, 10, 0)).toBe("medium");
    expect(estimateCoverage(6, 10, 0)).toBe("high");
    expect(estimateCoverage(0, 5, 3)).toBe("high"); // scenarios count
  });

  it("scores a dead, untested, incomplete package high and a healthy one low", () => {
    const bad = scoreDebt({
      coverage: "none",
      status: "dead",
      findings: [{ kind: "not_implemented", detail: "", severity: "high" }],
      healthScore: 40,
    });
    const good = scoreDebt({
      coverage: "high",
      status: "active",
      findings: [],
      healthScore: 95,
    });
    expect(bad).toBeGreaterThan(70);
    expect(good).toBe(0);
    expect(bad).toBeLessThanOrEqual(100);
  });

  it("TODO density raises the score but is capped", () => {
    const many = Array.from({ length: 100 }, () => ({
      kind: "todo" as const,
      detail: "",
      severity: "low" as const,
    }));
    expect(
      scoreDebt({ coverage: "high", status: "active", findings: many }),
    ).toBeLessThanOrEqual(35);
  });
});
