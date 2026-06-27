import type { PackageInfo } from "@package-workbench/plugin-sdk";
import { extractImports, readSourceFiles, type SourceFile } from "./source";
import type {
  ExportInventory,
  ExportUsage,
  ExportUsageReport,
  UsageClass,
} from "./types";

/**
 * Workspace usage analysis. Builds an index of which package exports are imported
 * where, then classifies each export with *conservative* deletion safety.
 *
 * The cardinal rule: never tell someone to delete a public package's export. We
 * can only prove internal usage; external consumers are invisible. So:
 *   public + unused-internally  → public-api-unknown  (do NOT delete)
 *   private + unused + ambiguous→ likely-dead          (review)
 *   private + unused + clear    → definitely-dead       (safe to delete)
 */

/** A reference to a package's export from some consumer. */
interface UsageHit {
  consumer: string;
  /** Imported names ('*' = namespace/wildcard, 'default' = default import). */
  names: Set<string>;
  fromTest: boolean;
}

export interface ImportIndex {
  /** importedPackageName → consumers (with the names they import). */
  byPackage: Map<string, UsageHit[]>;
}

/** Build the workspace-wide import index from every package's source. */
export async function buildImportIndex(
  packages: PackageInfo[],
  filesByPkg?: Map<string, SourceFile[]>,
): Promise<ImportIndex> {
  const names = new Set(packages.map((p) => p.name));
  const byPackage = new Map<string, UsageHit[]>();

  for (const pkg of packages) {
    const files = filesByPkg?.get(pkg.id) ?? (await readSourceFiles(pkg));
    for (const f of files) {
      for (const ref of extractImports(f)) {
        const target = resolveToPackage(ref.specifier, names);
        if (!target || target === pkg.name) continue; // external or self-import
        const hits = byPackage.get(target) ?? [];
        hits.push({
          consumer: pkg.id,
          names: new Set(ref.names.length ? ref.names : ["*"]),
          fromTest: f.isTest,
        });
        byPackage.set(target, hits);
      }
    }
  }
  return { byPackage };
}

/** Map an import specifier to an internal package name, if it is one. */
function resolveToPackage(
  specifier: string,
  names: Set<string>,
): string | null {
  if (names.has(specifier)) return specifier;
  // Subpath import: `@scope/pkg/sub` → `@scope/pkg`.
  for (const name of names) {
    if (specifier === name || specifier.startsWith(name + "/")) return name;
  }
  return null;
}

/** Classify each export of one package against the workspace import index. */
export function analyzeUsage(
  inventory: ExportInventory,
  index: ImportIndex,
): ExportUsageReport {
  const hits = index.byPackage.get(inventory.packageName) ?? [];
  // Names imported by name, plus whether anyone imports the package wholesale.
  const importedNames = new Set<string>();
  const namespaceConsumers = new Set<string>();
  const consumersByName = new Map<string, Set<string>>();
  for (const h of hits) {
    for (const n of h.names) {
      if (n === "*") {
        namespaceConsumers.add(h.consumer);
      } else {
        importedNames.add(n);
        (
          consumersByName.get(n) ?? consumersByName.set(n, new Set()).get(n)!
        ).add(h.consumer);
      }
    }
  }
  // A wildcard/namespace/`export *` consumer means we can't prove a specific
  // symbol is unused → treat the whole surface as ambiguously used.
  const wildcardUse = namespaceConsumers.size > 0;

  const summary: Record<UsageClass, number> = {
    used: 0,
    "unused-internally": 0,
    "public-api-unknown": 0,
    "likely-dead": 0,
    "definitely-dead": 0,
  };

  const exports: ExportUsage[] = inventory.symbols.map((symbol) => {
    const byName = consumersByName.get(symbol.name);
    const internalUses = byName?.size ?? 0;
    const consumers = byName ? [...byName].sort() : [];

    let usageClass: UsageClass;
    let confidence: number;
    let note: string;

    if (internalUses > 0) {
      usageClass = "used";
      confidence = 0.95;
      note = `Imported by ${internalUses} internal package(s).`;
    } else if (wildcardUse) {
      // Someone imports the package wholesale; can't prove this symbol is dead.
      usageClass = inventory.private ? "likely-dead" : "public-api-unknown";
      confidence = 0.2;
      note =
        "No direct named import, but the package is imported wholesale (namespace/`export *`) — usage cannot be ruled out.";
    } else if (!inventory.private) {
      usageClass = "public-api-unknown";
      confidence = 0.3;
      note =
        "Unused internally, but the package is published — external consumers may rely on it. Do NOT delete on this basis.";
    } else {
      // Private package, no internal usage.
      const ambiguous =
        symbol.kind === "star-re-export" ||
        symbol.kind === "default" ||
        symbol.typeOnly ||
        inventory.hasStarReExport;
      usageClass = ambiguous ? "likely-dead" : "definitely-dead";
      confidence = ambiguous ? 0.55 : 0.85;
      note = ambiguous
        ? "Private package with no internal usage, but re-exports/types make tracking imperfect — review before deleting."
        : "Private package, no internal usage, unambiguous — safe to remove.";
    }

    summary[usageClass]++;
    return { symbol, usageClass, consumers, internalUses, confidence, note };
  });

  // Stale re-exports: forwarded symbols that nothing imports.
  const staleReExports = exports
    .filter(
      (e) =>
        (e.symbol.kind === "re-export" || e.symbol.kind === "star-re-export") &&
        e.usageClass !== "used" &&
        e.usageClass !== "public-api-unknown",
    )
    .map((e) => ({
      file: e.symbol.file,
      from: e.symbol.from ?? "",
      note: `Re-export of \`${e.symbol.name}\` is not imported anywhere internally (${e.usageClass}).`,
    }));

  return {
    packageId: inventory.packageId,
    packageName: inventory.packageName,
    private: inventory.private,
    exports,
    summary,
    staleReExports,
  };
}
