import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
  HistoricalRun,
  PackageSnapshot,
} from "@package-workbench/plugin-sdk";
import { DEFAULT_CI_POLICY } from "@package-workbench/plugin-sdk";
import { compareRuns, hasCriticalFailure } from "./delta";
import { evaluateCiPolicy } from "./ci";
import { renderReport } from "./report";
import { buildSnapshot } from "./snapshot";
import { buildNotifications } from "./notify";
import { createJsonRunStore } from "./store";
import { createMockRun } from "../mock-runner";

function pkg(
  id: string,
  score: number,
  status: PackageSnapshot["status"],
  failed: string[] = [],
): PackageSnapshot {
  return {
    id,
    name: id,
    score,
    status,
    failedCheckIds: failed,
    scenarioPassRate: null,
  };
}

function hrun(
  id: string,
  score: number,
  packages: PackageSnapshot[],
  extra: Partial<HistoricalRun> = {},
): HistoricalRun {
  return {
    id,
    metadata: {
      runId: id,
      timestamp: `2020-01-01T00:00:0${id.slice(-1)}.000Z`,
      workspacePath: "/ws",
      gitBranch: "main",
    },
    overallScore: score,
    summary: {
      totalPackages: packages.length,
      passed: 0,
      warned: 0,
      failed: 0,
      averageScore: score,
    },
    packages,
    graph: null,
    scenarios: null,
    ...extra,
  };
}

describe("compareRuns", () => {
  it("detects a critical regression from a new import failure", () => {
    const prev = hrun("r1", 90, [pkg("a", 100, "pass")]);
    const curr = hrun("r2", 70, [
      pkg("a", 60, "fail", ["runtime_import_check"]),
    ]);
    const delta = compareRuns(prev, curr);
    expect(delta.scoreDelta).toBe(-20);
    expect(delta.regressions[0]!.severity).toBe("critical");
  });

  it("detects resolved failures as improvements", () => {
    const prev = hrun("r1", 70, [pkg("a", 60, "fail", ["exports_map_check"])]);
    const curr = hrun("r2", 100, [pkg("a", 100, "pass")]);
    const delta = compareRuns(prev, curr);
    expect(
      delta.improvements.some((i) => i.kind.includes("exports_map_check")),
    ).toBe(true);
  });

  it("flags new cycles and scenario regressions as major", () => {
    const prev = hrun("r1", 90, [pkg("a", 90, "pass")], {
      graph: {
        score: 100,
        grade: "A",
        cycleCount: 0,
        violationCount: 0,
        smellCount: 0,
      },
      scenarios: { total: 4, passed: 4, failed: 0, passRate: 1 },
    });
    const curr = hrun("r2", 88, [pkg("a", 90, "pass")], {
      graph: {
        score: 80,
        grade: "B",
        cycleCount: 1,
        violationCount: 0,
        smellCount: 0,
      },
      scenarios: { total: 4, passed: 2, failed: 2, passRate: 0.5 },
    });
    const delta = compareRuns(prev, curr);
    expect(delta.graphDelta?.newCycles).toBe(1);
    expect(delta.regressions.some((r) => r.kind === "new_cycle")).toBe(true);
    expect(
      delta.regressions.some((r) => r.kind === "scenario_regression"),
    ).toBe(true);
  });
});

describe("hasCriticalFailure", () => {
  it("is true when a package has a critical check failure", () => {
    expect(
      hasCriticalFailure(
        hrun("r", 50, [pkg("a", 0, "fail", ["runtime_import_check"])]),
      ),
    ).toBe(true);
    expect(
      hasCriticalFailure(
        hrun("r", 90, [pkg("a", 90, "warn", ["required_scripts_present"])]),
      ),
    ).toBe(false);
  });
});

describe("evaluateCiPolicy", () => {
  const clean = hrun("r2", 95, [pkg("a", 95, "pass")]);
  it("passes a clean run", () => {
    expect(evaluateCiPolicy(clean, null, DEFAULT_CI_POLICY).passed).toBe(true);
  });
  it("fails on a critical failure", () => {
    const bad = hrun("r2", 60, [pkg("a", 0, "fail", ["runtime_import_check"])]);
    const res = evaluateCiPolicy(bad, null, DEFAULT_CI_POLICY);
    expect(res.passed).toBe(false);
    expect(res.violations.some((v) => v.rule === "failOnCritical")).toBe(true);
  });
  it("fails when the score drops beyond the limit", () => {
    const prev = hrun("r1", 95, [pkg("a", 95, "pass")]);
    const curr = hrun("r2", 85, [pkg("a", 85, "warn")]);
    const res = evaluateCiPolicy(curr, compareRuns(prev, curr), {
      maxScoreDrop: 5,
    });
    expect(res.passed).toBe(false);
    expect(res.violations[0]!.rule).toBe("maxScoreDrop");
  });
  it("reports baselineMissing when there is no previous run", () => {
    expect(
      evaluateCiPolicy(clean, null, DEFAULT_CI_POLICY).baselineMissing,
    ).toBe(true);
  });
});

describe("buildNotifications", () => {
  it("raises a critical notification on score collapse", () => {
    const prev = hrun("r1", 90, [pkg("a", 90, "pass")]);
    const curr = hrun("r2", 70, [pkg("a", 70, "warn")]);
    const notes = buildNotifications(curr, compareRuns(prev, curr));
    expect(notes.some((n) => n.level === "critical")).toBe(true);
  });
});

describe("renderReport", () => {
  const run = createMockRun();
  it("renders markdown with all sections", () => {
    const md = renderReport({ run }, "markdown");
    for (const section of [
      "Executive Summary",
      "Package Health",
      "Failures",
      "Dependency Graph Summary",
      "Scenario Results",
    ]) {
      expect(md).toContain(section);
    }
  });
  it("renders valid JSON", () => {
    expect(() => JSON.parse(renderReport({ run }, "json"))).not.toThrow();
  });
  it("renders a self-contained HTML document", () => {
    expect(renderReport({ run }, "html")).toMatch(/^<!doctype html>/);
  });
});

describe("buildSnapshot", () => {
  it("distils a run into a compact snapshot", () => {
    const snap = buildSnapshot(createMockRun(), {
      workspacePath: "/ws",
      runId: "run-1",
      timestamp: "T",
    });
    expect(snap.packages).toHaveLength(4);
    expect(snap.graph).not.toBeNull();
    expect(snap.scenarios).not.toBeNull();
  });
});

describe("createJsonRunStore", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  it("saves, lists, and finds the latest run", async () => {
    dir = await mkdtemp(join(tmpdir(), "pw-history-"));
    const store = createJsonRunStore(dir);
    await store.save(hrun("run-a", 90, [pkg("a", 90, "pass")]));
    await store.save(hrun("run-b", 80, [pkg("a", 80, "warn")]));
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect((await store.latest("main"))?.id).toBe("run-b"); // newer timestamp
    expect((await store.get("run-a"))?.overallScore).toBe(90);
    await store.prune(1);
    expect(await store.list()).toHaveLength(1);
  });
});
