import type {
  DependencyGraph,
  HistoricalRun,
  PackageInfo,
} from "@package-workbench/plugin-sdk";
import type { WorkbenchRun } from "../types";
import { buildSnapshot } from "../history/snapshot";
import { compareRuns } from "../history/delta";
import { analyzeImpact } from "./blast-radius";
import { assessRisk } from "./risk";
import { decideMerge } from "./policy";
import {
  DEFAULT_MERGE_POLICY,
  type BlastRadius,
  type ChangedPackage,
  type MergePolicy,
  type PrReview,
} from "./types";

/**
 * The PR analysis engine. Given a base snapshot and the PR (head) run, it:
 *   1. diffs them with the existing delta engine,
 *   2. attributes changed files to packages and computes the dependency-aware
 *      blast radius,
 *   3. scores risk, and
 *   4. applies the merge policy.
 *
 * Deterministic given its inputs (clock injectable). Fast enough for CI: it does
 * no scanning itself — it consumes runs the engine already produced.
 */

export interface AnalyzePrOptions {
  /** Baseline snapshot (typically loaded from history for the base branch). */
  base: HistoricalRun;
  /** The PR run — provides packages, graph, and scores for the head. */
  head: WorkbenchRun;
  /** Workspace-relative changed files (e.g. from `git diff --name-only base...HEAD`). */
  changedFiles?: string[];
  /** Merge policy; defaults to {@link DEFAULT_MERGE_POLICY}. */
  policy?: MergePolicy;
  /** Graph override (defaults to `head.graph`). */
  graph?: DependencyGraph | null;
  /** Branch/commit labels for display. */
  baseRef?: string;
  headRef?: string;
  /** Injectable clock for deterministic output. */
  now?: () => string;
}

const EMPTY_BLAST: BlastRadius = {
  edited: [],
  impacted: [],
  total: [],
  byPackage: [],
  coverage: 0,
};

export function analyzePullRequest(opts: AnalyzePrOptions): PrReview {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const policy = { ...DEFAULT_MERGE_POLICY, ...(opts.policy ?? {}) };
  const graph = opts.graph ?? opts.head.graph ?? null;

  // 1) Diff head against base using the existing delta engine.
  const headSnapshot = buildSnapshot(opts.head, {
    workspacePath: opts.head.workspace.root,
    runId: `pr-head-${at}`,
    timestamp: at,
    git: { branch: opts.headRef ?? opts.base.metadata.gitBranch },
  });
  const delta = compareRuns(opts.base, headSnapshot);

  // 2) Blast radius (needs the graph; degrades gracefully without it).
  const packages: PackageInfo[] = opts.head.reports.map((r) => r.package);
  const {
    changed,
    blastRadius,
  }: { changed: ChangedPackage[]; blastRadius: BlastRadius } = graph
    ? analyzeImpact(
        graph,
        packages,
        opts.head.workspace.root,
        opts.changedFiles ?? [],
      )
    : { changed: [], blastRadius: EMPTY_BLAST };

  // 3) Risk.
  const risk = assessRisk({ delta, blastRadius, changed });

  // 4) Merge decision.
  const decision = decideMerge({ delta, risk, head: headSnapshot, policy });

  return {
    base: {
      ref: opts.baseRef ?? opts.base.metadata.gitBranch,
      score: opts.base.overallScore,
    },
    head: {
      ref: opts.headRef ?? headSnapshot.metadata.gitBranch,
      score: headSnapshot.overallScore,
    },
    scoreDelta: delta.scoreDelta,
    changed,
    blastRadius,
    delta,
    risk,
    decision,
    generatedAt: at,
  };
}
