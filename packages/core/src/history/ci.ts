import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CiPolicy,
  CiResult,
  CiViolation,
  HistoricalRun,
  RunDelta,
} from "@package-workbench/plugin-sdk";
import { DEFAULT_CI_POLICY } from "@package-workbench/plugin-sdk";
import { hasCriticalFailure } from "./delta";

/**
 * CI policy evaluation: given the current run and (optionally) its delta against
 * a baseline, decide whether CI should pass. Pure + deterministic; the CLI maps
 * `passed` to the process exit code.
 */
export function evaluateCiPolicy(
  current: HistoricalRun,
  delta: RunDelta | null,
  policy: CiPolicy,
): CiResult {
  const violations: CiViolation[] = [];

  if (policy.minScore != null && current.overallScore < policy.minScore) {
    violations.push({
      rule: "minScore",
      detail: `Health score ${current.overallScore} is below the minimum ${policy.minScore}`,
    });
  }

  if (
    delta &&
    policy.maxScoreDrop != null &&
    -delta.scoreDelta > policy.maxScoreDrop
  ) {
    violations.push({
      rule: "maxScoreDrop",
      detail: `Health score dropped ${-delta.scoreDelta} (limit ${policy.maxScoreDrop})`,
    });
  }

  if (policy.failOnCritical && hasCriticalFailure(current)) {
    violations.push({
      rule: "failOnCritical",
      detail:
        "A package has a critical failure (unusable / import / build failure)",
    });
  }

  if (
    policy.failOnNewCycle &&
    delta?.graphDelta &&
    delta.graphDelta.newCycles > 0
  ) {
    violations.push({
      rule: "failOnNewCycle",
      detail: `${delta.graphDelta.newCycles} new circular dependency(ies)`,
    });
  }

  if (
    policy.failOnNewViolation &&
    delta?.graphDelta &&
    delta.graphDelta.newViolations > 0
  ) {
    violations.push({
      rule: "failOnNewViolation",
      detail: `${delta.graphDelta.newViolations} new boundary violation(s)`,
    });
  }

  if (
    policy.failOnScenarioRegression &&
    delta?.scenarioDelta &&
    (delta.scenarioDelta.newFailures > 0 ||
      delta.scenarioDelta.passRateDelta < 0)
  ) {
    violations.push({
      rule: "failOnScenarioRegression",
      detail: `Scenario pass rate regressed`,
    });
  }

  return {
    passed: violations.length === 0,
    score: current.overallScore,
    scoreDelta: delta?.scoreDelta ?? 0,
    violations,
    regressionCount: delta?.regressions.length ?? 0,
    baselineMissing: delta === null,
  };
}

const CONFIG_CANDIDATES = [
  "workbench.config.ts",
  "workbench.config.mts",
  "workbench.config.js",
  "workbench.config.mjs",
  "workbench.config.cjs",
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Load a CI policy from config, merged over {@link DEFAULT_CI_POLICY}. Never throws. */
export async function loadCiPolicy(cwd: string): Promise<CiPolicy> {
  for (const name of CONFIG_CANDIDATES) {
    const abs = join(cwd, name);
    if (!(await exists(abs))) continue;
    try {
      const mod = (await import(pathToFileURL(abs).href)) as Record<
        string,
        unknown
      >;
      const cfg = (mod.default ?? mod) as { ci?: CiPolicy };
      return { ...DEFAULT_CI_POLICY, ...(cfg.ci ?? {}) };
    } catch {
      return { ...DEFAULT_CI_POLICY };
    }
  }
  const pkgPath = join(cwd, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        packageWorkbench?: { ci?: CiPolicy };
      };
      if (pkg.packageWorkbench?.ci)
        return { ...DEFAULT_CI_POLICY, ...pkg.packageWorkbench.ci };
    } catch {
      /* ignore */
    }
  }
  return { ...DEFAULT_CI_POLICY };
}
