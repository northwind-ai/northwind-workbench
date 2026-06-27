import type { PackageInfo } from "@package-workbench/plugin-sdk";
import { extractExports, readSourceFiles, type SourceFile } from "./source";
import type { ExportInventory, ExportSymbol } from "./types";

/**
 * Builds the per-package export inventory: every named/default/re-export/`export *`
 * and type-only export found in source, plus the subpaths declared in the
 * package.json "exports" map. Conservative — it never throws on odd source.
 */

export async function buildExportInventory(
  pkg: PackageInfo,
  files?: SourceFile[],
): Promise<ExportInventory> {
  const sourceFiles = files ?? (await readSourceFiles(pkg));
  const symbols: ExportSymbol[] = [];
  for (const f of sourceFiles) {
    if (f.isTest) continue; // tests don't define a package's public surface
    symbols.push(...extractExports(f));
  }

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    private: pkg.private,
    symbols,
    exportsMapEntries: exportsMapEntries(pkg),
    hasStarReExport: symbols.some((s) => s.kind === "star-re-export"),
  };
}

/** The subpath keys declared in the package.json "exports" map. */
export function exportsMapEntries(pkg: PackageInfo): string[] {
  const exp = pkg.manifest.exports;
  if (!exp || typeof exp !== "object") return [];
  return Object.keys(exp as Record<string, unknown>).filter((k) =>
    k.startsWith("."),
  );
}
