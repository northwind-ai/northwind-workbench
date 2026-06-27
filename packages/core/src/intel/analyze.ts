import type { PackageInfo } from "@package-workbench/plugin-sdk";
import { extractImports, readSourceFiles, type SourceFile } from "./source";
import { buildExportInventory } from "./inventory";
import { analyzeUsage, buildImportIndex } from "./usage";
import { analyzeSize, type SizeOptions } from "./size";
import {
  analyzeDependencyWeight,
  bareModuleName,
  findDuplicateVersions,
  type DepUsage,
} from "./deps";
import type { PackageIntelligenceReport } from "./types";

/**
 * The package-intelligence orchestrator. Reads each package's source exactly
 * once, then runs every analyzer (exports, usage, size, dependency weight) over
 * the shared data so a whole monorepo is a single O(n) pass — fast enough for CI.
 * Deterministic given the packages + clock.
 */

export interface IntelOptions {
  /** Compute gzip sizes (slower). Default true. */
  gzip?: boolean;
  /** Measure bundle sizes (touches the filesystem). Default true. */
  size?: boolean;
  /** Previous total bytes per package id, for size deltas. */
  previousBytes?: Record<string, number>;
  now?: () => string;
}

export async function analyzePackageIntelligence(
  packages: PackageInfo[],
  opts: IntelOptions = {},
): Promise<PackageIntelligenceReport> {
  const now = opts.now ?? (() => new Date().toISOString());

  // 1) Read every package's source once.
  const filesByPkg = new Map<string, SourceFile[]>();
  for (const pkg of packages)
    filesByPkg.set(pkg.id, await readSourceFiles(pkg));

  // 2) Export inventories + the workspace import index.
  const inventories = await Promise.all(
    packages.map((p) => buildExportInventory(p, filesByPkg.get(p.id))),
  );
  const index = await buildImportIndex(packages, filesByPkg);

  // 3) Usage classification.
  const usage = inventories.map((inv) => analyzeUsage(inv, index));

  // 4) Size (optional FS measurement).
  const sizeOpts = (id: string): SizeOptions => ({
    gzip: opts.gzip ?? true,
    previousBytes: opts.previousBytes?.[id],
  });
  const sizes =
    opts.size === false
      ? []
      : await Promise.all(packages.map((p) => analyzeSize(p, sizeOpts(p.id))));

  // 5) Dependency weight (per package, from its own imports) + duplicate versions.
  const dependencyWeight = packages.map((p) =>
    analyzeDependencyWeight(p, depUsageFor(p, filesByPkg.get(p.id) ?? [])),
  );
  const duplicateVersions = findDuplicateVersions(packages);

  return {
    inventories,
    usage,
    sizes,
    dependencyWeight,
    duplicateVersions,
    generatedAt: now(),
  };
}

/** External module names imported by a package, split runtime vs test. */
function depUsageFor(pkg: PackageInfo, files: SourceFile[]): DepUsage {
  const runtime = new Set<string>();
  const test = new Set<string>();
  for (const f of files) {
    for (const ref of extractImports(f)) {
      const bare = bareModuleName(ref.specifier);
      if (!bare || bare === pkg.name) continue;
      (f.isTest ? test : runtime).add(bare);
    }
  }
  return { runtime, test };
}
