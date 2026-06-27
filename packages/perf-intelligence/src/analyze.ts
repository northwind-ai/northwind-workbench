import {
  createRunner,
  summarize,
  analyzePackageIntelligence,
  type WorkbenchRun,
} from "@package-workbench/core";
import { collectSnapshot } from "./collect";
import { profileBuilds } from "./profile";
import { createPerfStore, defaultPerfDir } from "./store";
import { compareSnapshots } from "./regression";
import { rankBottlenecks } from "./rank";
import type { PerformanceReport } from "./types";

/**
 * The Performance Intelligence orchestrator. Reuses the runner (check timings),
 * package intelligence (bundle sizes + dependency weight), and — optionally — a
 * live build profile, then collects a snapshot, ranks bottlenecks, and compares
 * against the stored baseline for regressions.
 */

export interface AnalyzePerfOptions {
  /** Run builds for accurate per-package build timing (executes builds). */
  profile?: boolean;
  /** Compute gzip sizes (slower). */
  gzip?: boolean;
  /** Persist this snapshot as the new baseline. Default true. */
  save?: boolean;
  now?: () => string;
}

export async function analyzePerformance(
  cwd: string,
  opts: AnalyzePerfOptions = {},
): Promise<PerformanceReport> {
  const now = opts.now ?? (() => new Date().toISOString());
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { workspace, packages } = await runner.inspect();

  const reports = [];
  for (const pkg of packages)
    reports.push(await runner.checkPackage(pkg, workspace));
  const at = now();
  const run: WorkbenchRun = {
    id: `perf-run-${at}`,
    workspace,
    reports,
    summary: summarize(reports),
    startedAt: at,
    finishedAt: at,
  };

  let intel;
  try {
    intel = await analyzePackageIntelligence(packages, {
      size: true,
      gzip: opts.gzip ?? false,
      now,
    });
  } catch {
    intel = undefined;
  }

  const buildSamples = opts.profile
    ? await profileBuilds(cwd, packages, workspace)
    : undefined;
  const snapshot = collectSnapshot({
    run,
    intel,
    workspacePath: cwd,
    buildSamples,
    now,
  });

  const store = createPerfStore(defaultPerfDir(cwd));
  let regressions: PerformanceReport["regressions"] = [];
  try {
    const baseline = await store.latest();
    if (baseline) regressions = compareSnapshots(baseline, snapshot);
  } catch {
    /* no baseline */
  }

  if (opts.save !== false) await store.save(snapshot).catch(() => {});

  return {
    snapshot,
    bottlenecks: rankBottlenecks(snapshot),
    regressions,
    generatedAt: at,
  };
}
