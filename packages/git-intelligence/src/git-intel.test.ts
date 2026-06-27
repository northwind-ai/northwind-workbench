import { describe, expect, it } from "vitest";
import type { BlastRadius } from "@package-workbench/core";
import { parseNameStatus, parseUntracked, diffArgs } from "./git";
import { classifyFile, scoreDiffRisk } from "./risk";
import { predictRegressions, planScans, scanSavings } from "./predict";
import type { ChangedFile, ChangedPackageInfo } from "./types";

/**
 * Pure-function tests across the required fixtures: a small diff, a central-package
 * diff, a deleted package, and a renamed package. Git output is fed as fixture
 * strings (no real git needed) — deterministic + cross-platform.
 */

// ---- git parsing -------------------------------------------------------------

describe("parseNameStatus", () => {
  it("parses add / modify / delete", () => {
    const files = parseNameStatus(
      "A\tpackages/new/src/x.ts\nM\tpackages/core/src/index.ts\nD\tpackages/old/y.ts",
    );
    expect(files).toEqual([
      { path: "packages/new/src/x.ts", status: "added" },
      { path: "packages/core/src/index.ts", status: "modified" },
      { path: "packages/old/y.ts", status: "deleted" },
    ]);
  });

  it("parses a rename with old → new paths", () => {
    const files = parseNameStatus("R100\tpackages/a/old.ts\tpackages/a/new.ts");
    expect(files[0]).toEqual({
      path: "packages/a/new.ts",
      oldPath: "packages/a/old.ts",
      status: "renamed",
    });
  });

  it("normalizes backslashes and ignores blank lines", () => {
    expect(parseNameStatus("M\tpackages\\core\\src\\a.ts\n\n")[0]!.path).toBe(
      "packages/core/src/a.ts",
    );
  });

  it("parseUntracked picks up ?? lines", () => {
    expect(
      parseUntracked("?? packages/new/file.ts\n M packages/core/x.ts"),
    ).toEqual([{ path: "packages/new/file.ts", status: "added" }]);
  });

  it("builds the right git args per mode", () => {
    expect(diffArgs({ mode: "staged" })).toContain("--cached");
    expect(diffArgs({ mode: "working" })).toContain("HEAD");
    expect(
      diffArgs({ mode: "range", base: "main", head: "feature" }),
    ).toContain("main...feature");
  });
});

// ---- file classification -----------------------------------------------------

describe("classifyFile", () => {
  it("weights entry/manifest high and docs/tests low", () => {
    expect(classifyFile("packages/core/src/index.ts").weight).toBeGreaterThan(
      classifyFile("packages/core/src/util.ts").weight,
    );
    expect(classifyFile("README.md").weight).toBe(0);
    expect(classifyFile("packages/core/src/a.test.ts").weight).toBeLessThan(
      classifyFile("packages/core/src/a.ts").weight,
    );
    expect(classifyFile("packages/core/package.json").category).toBe(
      "manifest",
    );
  });
});

// ---- risk scoring (the required fixtures) ------------------------------------

const blast = (
  edited: string[],
  impacted: string[],
  coverage: number,
): BlastRadius => ({
  edited,
  impacted,
  total: [...edited, ...impacted],
  byPackage: [],
  coverage,
});
const pkg = (
  id: string,
  reason: "edited" | "dependency",
  files: string[],
  centrality: number,
  dependents: number,
): ChangedPackageInfo => ({
  id,
  name: id,
  reason,
  changedFiles: files,
  centrality,
  dependents,
});

describe("scoreDiffRisk", () => {
  it("scores a README-only change as Low", () => {
    const risk = scoreDiffRisk({
      changed: [],
      blastRadius: blast([], [], 0),
      changedFiles: [{ path: "README.md", status: "modified" }],
    });
    expect(risk.level).toBe("low");
  });

  it("scores a central core change as High/Critical and explains why", () => {
    const changed = [
      pkg("@repo/core", "edited", ["packages/core/src/index.ts"], 0.9, 31),
      pkg("@repo/auth", "dependency", [], 0.4, 0),
      pkg("@repo/api", "dependency", [], 0.3, 0),
    ];
    const risk = scoreDiffRisk({
      changed,
      blastRadius: blast(["@repo/core"], ["@repo/auth", "@repo/api"], 0.8),
      changedFiles: [
        { path: "packages/core/src/index.ts", status: "modified" },
      ],
    });
    expect(["high", "critical"]).toContain(risk.level);
    expect(risk.reason).toContain("31 dependents");
  });

  it("a small leaf change is at most Medium", () => {
    const risk = scoreDiffRisk({
      changed: [pkg("@repo/app", "edited", ["packages/app/src/x.ts"], 0.1, 0)],
      blastRadius: blast(["@repo/app"], [], 0.1),
      changedFiles: [{ path: "packages/app/src/x.ts", status: "modified" }],
    });
    expect(["low", "medium"]).toContain(risk.level);
  });
});

// ---- regression prediction ---------------------------------------------------

describe("predictRegressions", () => {
  it("predicts import breakage + stale re-export for an exports change", () => {
    const files: ChangedFile[] = [
      { path: "packages/core/src/index.ts", status: "modified" },
    ];
    const kinds = predictRegressions(files, [
      pkg("@repo/core", "edited", ["packages/core/src/index.ts"], 0.9, 5),
    ]).map((r) => r.kind);
    expect(kinds).toContain("import_breakage");
    expect(kinds).toContain("stale_reexport");
  });

  it("predicts import breakage for a deleted file and a rename", () => {
    expect(
      predictRegressions(
        [{ path: "packages/a/x.ts", status: "deleted" }],
        [],
      ).some((r) => r.kind === "import_breakage"),
    ).toBe(true);
    expect(
      predictRegressions(
        [
          {
            path: "packages/a/new.ts",
            oldPath: "packages/a/old.ts",
            status: "renamed",
          },
        ],
        [],
      ).some((r) => r.kind === "import_breakage"),
    ).toBe(true);
  });

  it("predicts dependency breakage for a package.json change", () => {
    expect(
      predictRegressions(
        [{ path: "packages/a/package.json", status: "modified" }],
        [],
      ).some((r) => r.kind === "dependency_breakage"),
    ).toBe(true);
  });
});

// ---- scan planner ------------------------------------------------------------

describe("scan planner", () => {
  it("gives edited packages the full set and impacted packages the lighter set", () => {
    const plan = planScans([
      pkg("@repo/core", "edited", ["x"], 0.9, 3),
      pkg("@repo/auth", "dependency", [], 0.4, 0),
    ]);
    expect(plan.find((p) => p.packageId === "@repo/core")!.checks).toContain(
      "runtime",
    );
    expect(
      plan.find((p) => p.packageId === "@repo/auth")!.checks,
    ).not.toContain("runtime");
  });

  it("computes scan savings vs a full scan", () => {
    expect(scanSavings(2, 10)).toBeCloseTo(0.8);
    expect(scanSavings(0, 0)).toBe(0);
  });
});
