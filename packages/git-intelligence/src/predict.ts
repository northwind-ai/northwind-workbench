import type {
  ChangedFile,
  ChangedPackageInfo,
  RegressionPrediction,
  ScanPlanItem,
} from "./types";

/**
 * Regression prediction + the smart scan planner. Both are pure heuristics over
 * the changed files and the blast radius — they predict *what could break* and
 * *what is worth re-checking*, so a large-repo CI run only scans the affected
 * slice instead of everything.
 */

/** Predict likely regressions from the kinds of files that changed. */
export function predictRegressions(
  changedFiles: ChangedFile[],
  changed: ChangedPackageInfo[],
): RegressionPrediction[] {
  const editedIds = changed
    .filter((c) => c.reason === "edited")
    .map((c) => c.id);
  const out = new Map<string, RegressionPrediction>();
  const add = (
    kind: string,
    detail: string,
    likelihood: RegressionPrediction["likelihood"],
  ) => {
    if (!out.has(kind))
      out.set(kind, { kind, detail, likelihood, packages: editedIds });
  };

  for (const f of changedFiles) {
    const p = f.path.toLowerCase();
    if (/(^|\/)(index|exports)\.[jt]sx?$/.test(p)) {
      add(
        "import_breakage",
        "Entry/exports file changed — importers may break.",
        "high",
      );
      add(
        "stale_reexport",
        "A barrel/exports change can leave stale re-exports.",
        "medium",
      );
    }
    if (/\.d\.ts$/.test(p))
      add(
        "type_breakage",
        "Type declarations changed — downstream type errors possible.",
        "medium",
      );
    if (/package\.json$/.test(p)) {
      add(
        "dependency_breakage",
        "package.json changed — missing/peer/version issues possible.",
        "medium",
      );
    }
    if (f.status === "deleted" && /\.[jt]sx?$/.test(p))
      add(
        "import_breakage",
        "A source file was deleted — imports of it will fail.",
        "high",
      );
    if (f.status === "renamed")
      add(
        "import_breakage",
        "A file was renamed — imports of the old path will fail.",
        "high",
      );
    if (
      /\.[jt]sx?$/.test(p) &&
      !/\.(test|spec)\./.test(p) &&
      !out.has("runtime_failure")
    ) {
      add(
        "runtime_failure",
        "Runtime source changed — exercise the package to catch failures.",
        "low",
      );
    }
  }
  return [...out.values()];
}

const FULL_CHECKS = ["package_health", "runtime", "scenarios"];
const IMPACT_CHECKS = ["package_health", "scenarios"];

/**
 * The targeted scan plan: edited packages get the full check set; transitively
 * impacted packages get the lighter consumer-facing set. Everything else is
 * skipped.
 */
export function planScans(changed: ChangedPackageInfo[]): ScanPlanItem[] {
  const out: ScanPlanItem[] = [];
  for (const c of changed) {
    if (c.reason === "edited")
      out.push({
        packageId: c.id,
        checks: FULL_CHECKS,
        reason: `${c.changedFiles.length} file(s) changed`,
      });
    else
      out.push({
        packageId: c.id,
        checks: IMPACT_CHECKS,
        reason: "depends on a changed package",
      });
  }
  return out;
}

/** Fraction of packages that can be skipped vs a full scan. */
export function scanSavings(planned: number, totalPackages: number): number {
  if (totalPackages <= 0) return 0;
  return Math.max(0, Math.round((1 - planned / totalPackages) * 100) / 100);
}
