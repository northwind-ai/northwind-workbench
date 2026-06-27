import {
  scanWorkspace,
  analyzeDependencyGraph,
  analyzeImpact,
  createJsonRunStore,
  defaultHistoryDir,
  type HistoricalRun,
} from "@package-workbench/core";
import { getChangedFiles } from "./git";
import { scoreDiffRisk } from "./risk";
import { predictRegressions, planScans, scanSavings } from "./predict";
import type { ChangedPackageInfo, DiffReport, DiffSpec } from "./types";

/**
 * The Git Diff Intelligence orchestrator. Discovers changed files (git), builds
 * the dependency graph (core), computes the blast radius (the existing PR
 * engine), scores risk, predicts regressions, and emits a targeted scan plan —
 * so a large monorepo analyzes only what changed.
 */

export interface AnalyzeDiffOptions {
  now?: () => string;
}

export async function analyzeDiff(
  cwd: string,
  spec: DiffSpec,
  opts: AnalyzeDiffOptions = {},
): Promise<DiffReport> {
  const now = opts.now ?? (() => new Date().toISOString());
  const changedFiles = await getChangedFiles(cwd, spec);

  const { packages } = await scanWorkspace(cwd);
  const graph = await analyzeDependencyGraph(packages, {
    workspaceRoot: cwd,
    now,
  });

  // Reuse the PR blast-radius engine for changed-package + impact detection.
  const { changed, blastRadius } = analyzeImpact(
    graph,
    packages,
    cwd,
    changedFiles.map((f) => f.path),
  );
  const changedPackages = changed as ChangedPackageInfo[];

  const deletedPackages = changedFiles
    .filter(
      (f) => f.status === "deleted" && /(^|\/)package\.json$/.test(f.path),
    )
    .map((f) => f.path.replace(/\/package\.json$/, ""));

  let history: HistoricalRun[] | undefined;
  try {
    history = await createJsonRunStore(defaultHistoryDir(cwd)).all();
  } catch {
    history = undefined;
  }

  const risk = scoreDiffRisk({
    changed: changedPackages,
    blastRadius,
    changedFiles,
    history,
  });
  const predictedRegressions = predictRegressions(
    changedFiles,
    changedPackages,
  );
  const scanPlan = planScans(changedPackages);

  return {
    spec,
    changedFiles,
    changedPackages,
    blastRadius,
    deletedPackages,
    risk,
    predictedRegressions,
    scanPlan,
    scanSavings: scanSavings(scanPlan.length, packages.length),
    generatedAt: now(),
  };
}
