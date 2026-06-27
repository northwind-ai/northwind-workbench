import type { PackageInfo } from "@package-workbench/plugin-sdk";
import { browserImpact, builtinName } from "./builtins";
import { scanPackageImports, type ImportRef } from "./source-scan";

/**
 * Static browser-compatibility analysis. Scans a package's source for imports of
 * Node built-ins and classifies the resulting browser risk. No execution.
 */

export interface BuiltinUsage {
  /** Built-in module name (without the `node:` prefix). */
  name: string;
  impact: "hard" | "polyfillable";
  /** Source files that import it (relative, deduped, capped). */
  files: string[];
}

export interface BrowserCompatReport {
  /** `fail` if any hard breaker is used, `warn` for polyfillables only, else `pass`. */
  status: "pass" | "warn" | "fail";
  /** All Node built-ins used, worst-impact first. */
  usages: BuiltinUsage[];
  /** Just the hard-breaker names, for quick messaging. */
  hardBreakers: string[];
  filesScanned: number;
  truncated: boolean;
}

const MAX_FILES_PER_BUILTIN = 8;

/** Group import refs by the Node built-in they target. */
function groupBuiltins(refs: ImportRef[]): Map<string, Set<string>> {
  const byBuiltin = new Map<string, Set<string>>();
  for (const ref of refs) {
    const name = builtinName(ref.specifier);
    if (!name) continue;
    const head = name.includes("/") ? name.split("/")[0]! : name;
    const files = byBuiltin.get(head) ?? new Set<string>();
    files.add(ref.file);
    byBuiltin.set(head, files);
  }
  return byBuiltin;
}

/** Analyse a package's source for browser compatibility. */
export async function analyzeBrowserCompat(
  pkg: PackageInfo,
): Promise<BrowserCompatReport> {
  const { refs, filesScanned, truncated } = await scanPackageImports(pkg);
  const grouped = groupBuiltins(refs);

  const usages: BuiltinUsage[] = [...grouped.entries()].map(
    ([name, files]) => ({
      name,
      impact: browserImpact(name),
      files: [...files].slice(0, MAX_FILES_PER_BUILTIN),
    }),
  );
  // Hard breakers first, then alphabetical for stable output.
  usages.sort((a, b) =>
    a.impact === b.impact
      ? a.name.localeCompare(b.name)
      : a.impact === "hard"
        ? -1
        : 1,
  );

  const hardBreakers = usages
    .filter((u) => u.impact === "hard")
    .map((u) => u.name);
  const status: BrowserCompatReport["status"] =
    hardBreakers.length > 0 ? "fail" : usages.length > 0 ? "warn" : "pass";

  return { status, usages, hardBreakers, filesScanned, truncated };
}
