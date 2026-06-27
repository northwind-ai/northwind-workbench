import type { PackageHealthReport, PackageType } from "@package-workbench/core";

/**
 * Package filtering + search. Pure functions over the report list so the same
 * logic drives the sidebar, the command palette, and tests.
 */

export type StatusFilter = "all" | "failing" | "warning" | "passing";

export interface PackageFilter {
  /** Free text — matches name, dependency names, and failure messages. */
  query: string;
  status: StatusFilter;
  /** Only packages whose runtime import check failed. */
  runtimeFailures: boolean;
  minScore: number;
  maxScore: number;
  packageType: "all" | PackageType;
}

export const emptyFilter: PackageFilter = {
  query: "",
  status: "all",
  runtimeFailures: false,
  minScore: 0,
  maxScore: 100,
  packageType: "all",
};

/** Does the package match the free-text query (name / deps / failure messages)? */
export function matchesQuery(
  report: PackageHealthReport,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const pkg = report.package;
  if (pkg.name.toLowerCase().includes(q)) return true;
  const deps = [
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.devDependencies),
    ...Object.keys(pkg.peerDependencies),
  ];
  if (deps.some((d) => d.toLowerCase().includes(q))) return true;
  return report.checks.some(
    (c) =>
      (c.status === "fail" || c.status === "warn") &&
      (c.summary.toLowerCase().includes(q) ||
        (c.details ?? "").toLowerCase().includes(q)),
  );
}

function hasRuntimeFailure(report: PackageHealthReport): boolean {
  if (
    report.checks.some(
      (c) => c.checkId === "runtime_import_check" && c.status === "fail",
    )
  )
    return true;
  return report.runtime
    ? Object.values(report.runtime.matrix).includes("fail")
    : false;
}

const STATUS_OK: Record<StatusFilter, (r: PackageHealthReport) => boolean> = {
  all: () => true,
  failing: (r) => r.status === "fail",
  warning: (r) => r.status === "warn",
  passing: (r) => r.status === "pass",
};

/** Apply a filter to the report list. Order is preserved (caller sorts). */
export function applyFilters(
  reports: PackageHealthReport[],
  filter: PackageFilter,
): PackageHealthReport[] {
  return reports.filter((r) => {
    if (!STATUS_OK[filter.status](r)) return false;
    if (filter.runtimeFailures && !hasRuntimeFailure(r)) return false;
    if (r.score < filter.minScore || r.score > filter.maxScore) return false;
    if (
      filter.packageType !== "all" &&
      r.package.packageType !== filter.packageType
    )
      return false;
    if (!matchesQuery(r, filter.query)) return false;
    return true;
  });
}

/** How many filters are active beyond the defaults (for a UI badge). */
export function countActiveFilters(filter: PackageFilter): number {
  let n = 0;
  if (filter.query.trim()) n++;
  if (filter.status !== "all") n++;
  if (filter.runtimeFailures) n++;
  if (filter.minScore > 0 || filter.maxScore < 100) n++;
  if (filter.packageType !== "all") n++;
  return n;
}
