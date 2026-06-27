import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunDelta } from "@package-workbench/plugin-sdk";
import { hasCriticalFailure } from "../history/delta";
import type { HistoricalRun } from "@package-workbench/plugin-sdk";
import {
  DEFAULT_MERGE_POLICY,
  RISK_RANK,
  type MergeDecision,
  type MergePolicy,
  type RiskAssessment,
} from "./types";

/**
 * The merge-policy engine: given the PR delta + risk + the current head snapshot,
 * decide whether to approve, warn, or block. Pure + deterministic — the CI job
 * maps `block` to a failing status check.
 *
 * Two tiers, mirroring the spec:
 *   - **block**: critical failures, new cycles, scenario regressions, a major
 *     score drop, or risk at/above the configured threshold.
 *   - **warn**: smaller regressions that shouldn't gate merge but should be seen.
 */
export interface MergeDecisionInput {
  delta: RunDelta;
  risk: RiskAssessment;
  /** The PR (head) snapshot — used for absolute checks like critical failures. */
  head: HistoricalRun;
  policy: MergePolicy;
}

export function decideMerge({
  delta,
  risk,
  head,
  policy,
}: MergeDecisionInput): MergeDecision {
  const blockedBy: string[] = [];
  const reasons: string[] = [];

  if (policy.blockOnCriticalFailure && hasCriticalFailure(head)) {
    blockedBy.push("blockOnCriticalFailure");
    reasons.push("A package has a critical (unusable) failure");
  }
  if (policy.maxScoreDrop != null && -delta.scoreDelta > policy.maxScoreDrop) {
    blockedBy.push("maxScoreDrop");
    reasons.push(
      `Health score dropped ${-delta.scoreDelta} (limit ${policy.maxScoreDrop})`,
    );
  }
  if (
    policy.blockOnNewCycle &&
    delta.graphDelta &&
    delta.graphDelta.newCycles > 0
  ) {
    blockedBy.push("blockOnNewCycle");
    reasons.push(`${delta.graphDelta.newCycles} new dependency cycle(s)`);
  }
  if (
    policy.blockOnNewViolation &&
    delta.graphDelta &&
    delta.graphDelta.newViolations > 0
  ) {
    blockedBy.push("blockOnNewViolation");
    reasons.push(`${delta.graphDelta.newViolations} new boundary violation(s)`);
  }
  if (
    policy.blockOnScenarioRegression &&
    delta.scenarioDelta &&
    (delta.scenarioDelta.newFailures > 0 ||
      delta.scenarioDelta.passRateDelta < 0)
  ) {
    blockedBy.push("blockOnScenarioRegression");
    reasons.push("Scenario pass-rate regressed");
  }
  if (
    policy.blockAtRisk &&
    RISK_RANK[risk.level] >= RISK_RANK[policy.blockAtRisk]
  ) {
    blockedBy.push("blockAtRisk");
    reasons.push(
      `Computed risk is ${risk.level} (block threshold: ${policy.blockAtRisk})`,
    );
  }

  if (blockedBy.length > 0) {
    return { recommendation: "block", reasons: dedupe(reasons), blockedBy };
  }

  // Nothing blocks — warn if there are regressions worth surfacing.
  if (policy.warnOnRegression && delta.regressions.length > 0) {
    return {
      recommendation: "warn",
      reasons: [
        `${delta.regressions.length} regression(s) introduced — review before merge`,
      ],
      blockedBy: [],
    };
  }

  return {
    recommendation: "approve",
    reasons: ["No regressions or policy violations detected"],
    blockedBy: [],
  };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

const CONFIG_CANDIDATES = [
  "workbench.policy.ts",
  "workbench.policy.mts",
  "workbench.policy.js",
  "workbench.policy.mjs",
  "workbench.policy.cjs",
  "workbench.config.ts",
  "workbench.config.mjs",
  "workbench.config.js",
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a merge policy from `workbench.policy.*` (default export, or `.policy`
 * field), falling back to `workbench.config.*#policy` and
 * `package.json#packageWorkbench.policy`. Merged over {@link DEFAULT_MERGE_POLICY}.
 * Never throws.
 */
export async function loadMergePolicy(cwd: string): Promise<MergePolicy> {
  for (const name of CONFIG_CANDIDATES) {
    const abs = join(cwd, name);
    if (!(await exists(abs))) continue;
    try {
      const mod = (await import(pathToFileURL(abs).href)) as Record<
        string,
        unknown
      >;
      const cfg = (mod.default ?? mod) as Record<string, unknown>;
      // Accept either a bare policy object or a config with a `.policy` field.
      const policy =
        (cfg.policy as MergePolicy | undefined) ??
        (looksLikePolicy(cfg) ? (cfg as MergePolicy) : {});
      return { ...DEFAULT_MERGE_POLICY, ...policy };
    } catch {
      return { ...DEFAULT_MERGE_POLICY };
    }
  }
  const pkgPath = join(cwd, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        packageWorkbench?: { policy?: MergePolicy };
      };
      if (pkg.packageWorkbench?.policy)
        return { ...DEFAULT_MERGE_POLICY, ...pkg.packageWorkbench.policy };
    } catch {
      /* ignore */
    }
  }
  return { ...DEFAULT_MERGE_POLICY };
}

function looksLikePolicy(obj: Record<string, unknown>): boolean {
  const keys = [
    "maxScoreDrop",
    "blockOnCriticalFailure",
    "blockOnNewCycle",
    "blockOnNewViolation",
    "blockOnScenarioRegression",
    "blockAtRisk",
    "warnOnRegression",
  ];
  return keys.some((k) => k in obj);
}
