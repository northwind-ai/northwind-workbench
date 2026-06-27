import type { PackageInfo } from "@package-workbench/plugin-sdk";
import { HEAVY_CLIENT_DEPS } from "./size";
import type { DependencyIssue, DependencyWeightReport } from "./types";

/**
 * Dependency-weight analysis. Flags dependencies that bloat install/runtime:
 * unused declared deps, runtime deps only used in tests, known-heavy client deps,
 * and (at the workspace level) the same dependency pinned to multiple versions.
 *
 * Conservative: a "no import found" verdict carries a note that the dependency
 * may be used indirectly (a CLI bin, types, a peer), with sub-certain confidence.
 */

/** Reduce an import specifier to its bare package name (`lodash/fp` → `lodash`). */
export function bareModuleName(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  )
    return null;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split("/")[0] ?? null;
}

export interface DepUsage {
  /** External package names imported from non-test source. */
  runtime: Set<string>;
  /** External package names imported from test source. */
  test: Set<string>;
}

/** Analyze one package's declared runtime dependencies against actual imports. */
export function analyzeDependencyWeight(
  pkg: PackageInfo,
  usage: DepUsage,
): DependencyWeightReport {
  const deps = Object.keys(pkg.dependencies);
  const scriptsBlob = Object.values(pkg.scripts).join(" ");
  const issues: DependencyIssue[] = [];

  for (const dep of deps) {
    if (dep.startsWith("@types/")) continue; // type-only, used implicitly
    const usedRuntime = usage.runtime.has(dep);
    const usedTest = usage.test.has(dep);
    const usedInScript = scriptsBlob.includes(dep);

    if (!usedRuntime && !usedTest && !usedInScript) {
      issues.push({
        kind: "unused",
        dependency: dep,
        confidence: 0.6,
        detail:
          'Declared in "dependencies" but no import was found in source — may be used indirectly (bin/types/peer); verify before removing.',
      });
    } else if (!usedRuntime && usedTest) {
      issues.push({
        kind: "test-only-runtime",
        dependency: dep,
        confidence: 0.7,
        detail:
          "Imported only from tests but declared as a runtime dependency — consider moving to devDependencies.",
      });
    }

    if (
      (pkg.runtime === "browser" || pkg.runtime === "universal") &&
      HEAVY_CLIENT_DEPS.has(dep)
    ) {
      issues.push({
        kind: "heavy",
        dependency: dep,
        confidence: 0.5,
        detail:
          "A known-large dependency in a client package — check whether a lighter alternative or tree-shaking applies.",
      });
    }
  }

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    declaredCount: deps.length,
    issues,
  };
}

/** Find dependencies pinned to multiple distinct ranges across the workspace. */
export function findDuplicateVersions(
  packages: PackageInfo[],
): Array<{ dependency: string; versions: string[]; packages: string[] }> {
  const byDep = new Map<string, Map<string, Set<string>>>(); // dep → range → packages
  for (const pkg of packages) {
    const all = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    for (const [dep, range] of Object.entries(all)) {
      if (dep.startsWith("@types/")) continue;
      const ranges = byDep.get(dep) ?? new Map<string, Set<string>>();
      (ranges.get(range) ?? ranges.set(range, new Set()).get(range)!).add(
        pkg.name,
      );
      byDep.set(dep, ranges);
    }
  }

  const out: Array<{
    dependency: string;
    versions: string[];
    packages: string[];
  }> = [];
  for (const [dep, ranges] of byDep) {
    // Ignore workspace protocol + identical ranges.
    const distinct = [...ranges.keys()].filter(
      (r) => !r.startsWith("workspace:"),
    );
    if (distinct.length > 1) {
      const pkgs = new Set<string>();
      for (const r of distinct) for (const p of ranges.get(r)!) pkgs.add(p);
      out.push({
        dependency: dep,
        versions: distinct.sort(),
        packages: [...pkgs].sort(),
      });
    }
  }
  return out.sort((a, b) => b.versions.length - a.versions.length);
}
