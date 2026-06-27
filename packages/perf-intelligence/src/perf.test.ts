import { describe, expect, it } from "vitest";
import type {
  PackageHealthReport,
  PackageIntelligenceReport,
  WorkbenchRun,
} from "@package-workbench/core";
import { collectSnapshot } from "./collect";
import { computeMemory, analyzeDependencyCosts } from "./analyzers";
import { compareSnapshots } from "./regression";
import { rankBottlenecks } from "./rank";
import { deriveBuildCommand } from "./profile";
import type { PerformanceSnapshot } from "./types";

/**
 * Deterministic fixtures: slow builds (large bundle + many checks), heavy/duplicate
 * deps, memory spikes, and a regression between two snapshots. Built in-memory.
 */

const MB = 1024 * 1024;

function report(
  name: string,
  opts: {
    deps?: number;
    checkMs?: number;
    scenarioMs?: number;
    memory?: number[];
  } = {},
): PackageHealthReport {
  const dependencies: Record<string, string> = {};
  for (let i = 0; i < (opts.deps ?? 0); i++) dependencies[`dep${i}`] = "^1.0.0";
  return {
    package: { id: name, name, runtime: "node", dependencies },
    checks: [
      { checkId: "package_json_valid", durationMs: opts.checkMs ?? 0 } as never,
    ],
    scenarios:
      opts.scenarioMs != null || opts.memory
        ? {
            durationMs: opts.scenarioMs ?? 0,
            results: (opts.memory ?? []).map((m) => ({
              durationMs: 5,
              memoryBytes: m,
            })),
          }
        : undefined,
    score: 80,
  } as unknown as PackageHealthReport;
}

const run = (reports: PackageHealthReport[]): WorkbenchRun =>
  ({ reports }) as unknown as WorkbenchRun;

const intel = (
  sizes: Array<{ id: string; bytes: number }>,
  depWeight: Array<{ pkg: string; dep: string; kind: "heavy" | "unused" }> = [],
  dups: Array<{ dep: string; versions: string[]; packages: string[] }> = [],
): PackageIntelligenceReport =>
  ({
    sizes: sizes.map((s) => ({
      packageId: s.id,
      packageName: s.id,
      measured: true,
      totalBytes: s.bytes,
      fileCount: 1,
      largestFiles: [],
      heavyClientDeps: [],
    })),
    dependencyWeight: depWeight.map((d) => ({
      packageId: d.pkg,
      packageName: d.pkg,
      declaredCount: 1,
      issues: [
        {
          kind: d.kind,
          dependency: d.dep,
          detail: `${d.kind} dep`,
          confidence: 0.6,
        },
      ],
    })),
    duplicateVersions: dups.map((d) => ({
      dependency: d.dep,
      versions: d.versions,
      packages: d.packages,
    })),
    inventories: [],
    usage: [],
    generatedAt: "T",
  }) as unknown as PackageIntelligenceReport;

// ---- collection + build hotspot ----------------------------------------------

describe("collectSnapshot", () => {
  it("attributes build cost and finds the hotspot", () => {
    const snap = collectSnapshot({
      run: run([
        report("@repo/chart", { deps: 10, checkMs: 200 }),
        report("@repo/util", { deps: 1, checkMs: 10 }),
      ]),
      intel: intel([
        { id: "@repo/chart", bytes: 600 * 1024 },
        { id: "@repo/util", bytes: 5 * 1024 },
      ]),
      workspacePath: "/repo",
      now: () => "T",
    });
    const chart = snap.packages.find((p) => p.id === "@repo/chart")!;
    const util = snap.packages.find((p) => p.id === "@repo/util")!;
    expect(chart.build.contribution).toBeGreaterThan(util.build.contribution);
    expect(chart.build.measured).toBe(false); // estimated, no live profile
    expect(snap.totals.bundleBytes).toBe(605 * 1024);
  });

  it("uses measured build time when samples are supplied", () => {
    const snap = collectSnapshot({
      run: run([report("@repo/a"), report("@repo/b")]),
      workspacePath: "/repo",
      buildSamples: [
        { packageId: "@repo/a", durationMs: 41200 },
        { packageId: "@repo/b", durationMs: 2000 },
      ],
      now: () => "T",
    });
    const a = snap.packages.find((p) => p.id === "@repo/a")!;
    expect(a.build.measured).toBe(true);
    expect(a.build.durationMs).toBe(41200);
    expect(a.build.contribution).toBeCloseTo(41200 / 43200, 2);
    expect(snap.totals.buildMs).toBe(43200);
  });

  it("aggregates check costs across packages", () => {
    const snap = collectSnapshot({
      run: run([
        report("@repo/a", { checkMs: 100 }),
        report("@repo/b", { checkMs: 50 }),
      ]),
      workspacePath: "/repo",
      now: () => "T",
    });
    expect(snap.checkCosts[0]).toMatchObject({
      checkId: "package_json_valid",
      totalMs: 150,
      count: 2,
    });
  });
});

// ---- memory ------------------------------------------------------------------

describe("computeMemory", () => {
  it("flags a spike", () => {
    const m = computeMemory(
      report("@repo/a", { memory: [1 * MB, 1 * MB, 200 * MB] }),
    );
    expect(m.spike).toBe(true);
    expect(m.peakBytes).toBe(200 * MB);
  });
  it("suspects a leak when memory grows monotonically", () => {
    const m = computeMemory(
      report("@repo/a", { memory: [10 * MB, 20 * MB, 40 * MB] }),
    );
    expect(m.leakSuspicion).toBe(true);
  });
  it("is clean for flat memory", () => {
    const m = computeMemory(
      report("@repo/a", { memory: [10 * MB, 10 * MB, 10 * MB] }),
    );
    expect(m.leakSuspicion).toBe(false);
    expect(m.spike).toBe(false);
  });
});

// ---- dependency cost ---------------------------------------------------------

describe("analyzeDependencyCosts", () => {
  it("ranks duplicate-version families above heavy single deps", () => {
    const costs = analyzeDependencyCosts(
      intel(
        [],
        [{ pkg: "@repo/a", dep: "lodash", kind: "heavy" }],
        [
          {
            dep: "react",
            versions: ["^17", "^18"],
            packages: ["@repo/a", "@repo/b"],
          },
        ],
      ),
    );
    expect(costs[0]!.dependency).toBe("react");
    expect(costs[0]!.kind).toBe("duplicate");
    expect(
      costs.some((c) => c.dependency === "lodash" && c.kind === "heavy"),
    ).toBe(true);
  });
});

// ---- regression --------------------------------------------------------------

function snap(
  id: string,
  pkgs: Array<{ id: string; weight: number; bundle: number }>,
): PerformanceSnapshot {
  return collectSnapshot({
    run: run(pkgs.map((p) => report(p.id, { checkMs: p.weight }))),
    intel: intel(pkgs.map((p) => ({ id: p.id, bytes: p.bundle }))),
    workspacePath: "/repo",
    now: () => id,
  });
}

describe("compareSnapshots", () => {
  it("detects a build-time regression and reports the percentage", () => {
    const before = snap("s1", [
      { id: "@repo/chart", weight: 100, bundle: 100 * 1024 },
    ]);
    const after = snap("s2", [
      { id: "@repo/chart", weight: 100, bundle: 148 * 1024 },
    ]);
    const regs = compareSnapshots(before, after);
    const bundle = regs.find((r) => r.kind === "bundle");
    expect(bundle).toBeTruthy();
    expect(bundle!.pctChange).toBe(48);
    expect(bundle!.severity).toBe("major");
  });

  it("ignores small movements below threshold", () => {
    const before = snap("s1", [
      { id: "@repo/a", weight: 100, bundle: 100 * 1024 },
    ]);
    const after = snap("s2", [
      { id: "@repo/a", weight: 100, bundle: 105 * 1024 },
    ]);
    expect(compareSnapshots(before, after)).toHaveLength(0);
  });
});

// ---- ranking + build commands ------------------------------------------------

describe("rankBottlenecks", () => {
  it("surfaces a build + CI bottleneck", () => {
    const s = collectSnapshot({
      run: run([report("@repo/chart", { deps: 10, checkMs: 500 })]),
      intel: intel([{ id: "@repo/chart", bytes: 600 * 1024 }]),
      workspacePath: "/repo",
      now: () => "T",
    });
    const cats = rankBottlenecks(s).map((b) => b.category);
    expect(cats).toContain("build");
    expect(cats).toContain("ci");
  });
});

describe("deriveBuildCommand", () => {
  it("derives the right command per toolchain", () => {
    expect(
      deriveBuildCommand({
        packageName: "@r/x",
        hasBuildScript: true,
        packageManager: "pnpm",
        nx: false,
        turbo: false,
      }),
    ).toEqual({ cmd: "pnpm", args: ["--filter", "@r/x", "run", "build"] });
    expect(
      deriveBuildCommand({
        packageName: "@r/x",
        hasBuildScript: true,
        packageManager: "pnpm",
        nx: false,
        turbo: true,
      })!.args,
    ).toContain("--filter");
    expect(
      deriveBuildCommand({
        packageName: "@r/x",
        hasBuildScript: true,
        packageManager: "npm",
        nx: true,
        turbo: false,
      })!.args,
    ).toContain("nx");
    expect(
      deriveBuildCommand({
        packageName: "@r/x",
        hasBuildScript: false,
        packageManager: "npm",
        nx: false,
        turbo: false,
      }),
    ).toBeNull();
  });
});
