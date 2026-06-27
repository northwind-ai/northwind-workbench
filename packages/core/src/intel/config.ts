import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_INTEL_CONFIG, type IntelConfig } from "./types";

/**
 * Loads package-intelligence thresholds from `workbench.config.ts` (the `intel`
 * field, or top-level `api`/`size`), falling back to
 * `package.json#packageWorkbench.intel`. Merged over {@link DEFAULT_INTEL_CONFIG}.
 * Never throws.
 *
 *   // workbench.config.ts
 *   export default {
 *     api:  { flagUnusedExports: true },
 *     size: { maxPackageDistKb: 500, maxSingleFileKb: 200 },
 *   };
 */

export interface ResolvedIntelConfig {
  api: { flagUnusedExports: boolean };
  size: { maxPackageDistKb: number; maxSingleFileKb: number; gzip: boolean };
}

export function resolveIntelConfig(
  cfg: IntelConfig | undefined,
): ResolvedIntelConfig {
  const d = DEFAULT_INTEL_CONFIG;
  return {
    api: {
      flagUnusedExports: cfg?.api?.flagUnusedExports ?? d.api.flagUnusedExports,
    },
    size: {
      maxPackageDistKb: cfg?.size?.maxPackageDistKb ?? d.size.maxPackageDistKb,
      maxSingleFileKb: cfg?.size?.maxSingleFileKb ?? d.size.maxSingleFileKb,
      gzip: cfg?.size?.gzip ?? d.size.gzip,
    },
  };
}

const CONFIG_CANDIDATES = [
  "workbench.config.ts",
  "workbench.config.mts",
  "workbench.config.mjs",
  "workbench.config.js",
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

export async function loadIntelConfig(
  cwd: string,
): Promise<ResolvedIntelConfig> {
  for (const name of CONFIG_CANDIDATES) {
    const abs = join(cwd, name);
    if (!(await exists(abs))) continue;
    try {
      const mod = (await import(pathToFileURL(abs).href)) as Record<
        string,
        unknown
      >;
      const cfg = (mod.default ?? mod) as { intel?: IntelConfig } & IntelConfig;
      return resolveIntelConfig(cfg.intel ?? { api: cfg.api, size: cfg.size });
    } catch {
      return resolveIntelConfig(undefined);
    }
  }
  const pkgPath = join(cwd, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        packageWorkbench?: { intel?: IntelConfig };
      };
      if (pkg.packageWorkbench?.intel)
        return resolveIntelConfig(pkg.packageWorkbench.intel);
    } catch {
      /* ignore */
    }
  }
  return resolveIntelConfig(undefined);
}
