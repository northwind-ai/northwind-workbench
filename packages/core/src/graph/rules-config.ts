import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BoundaryRule } from "@package-workbench/plugin-sdk";

/**
 * Loads boundary rules from the workspace config — either a `boundaries` array
 * exported by `workbench.config.*` or a `packageWorkbench.boundaries` field in
 * package.json. Never throws: a bad config yields an empty rule set.
 */

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

export async function loadBoundaryRules(cwd: string): Promise<BoundaryRule[]> {
  for (const name of CONFIG_CANDIDATES) {
    const abs = join(cwd, name);
    if (!(await exists(abs))) continue;
    try {
      const mod = (await import(pathToFileURL(abs).href)) as Record<
        string,
        unknown
      >;
      const cfg = (mod.default ?? mod) as {
        boundaries?: BoundaryRule[];
        rules?: BoundaryRule[];
      };
      return normalize(cfg.boundaries ?? cfg.rules);
    } catch {
      return [];
    }
  }

  const pkgPath = join(cwd, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        packageWorkbench?: { boundaries?: BoundaryRule[] };
      };
      return normalize(pkg.packageWorkbench?.boundaries);
    } catch {
      return [];
    }
  }
  return [];
}

function normalize(rules: BoundaryRule[] | undefined): BoundaryRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r) =>
      r &&
      typeof r.from === "string" &&
      (r.cannotDependOn || r.canOnlyDependOn),
  );
}
