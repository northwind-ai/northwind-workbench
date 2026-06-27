import type { PackageInfo } from "@package-workbench/plugin-sdk";
import type { TurboPackageClass } from "./types";

/**
 * Turborepo specifics: parsing `turbo.json` (both the modern `tasks` key and the
 * legacy `pipeline` key) and classifying packages into Turborepo's mental model
 * (app / package / tool / config). Pure functions over already-parsed data.
 */

export interface TurboConfig {
  /** Task names from `tasks` (v2) or `pipeline` (v1). */
  tasks: string[];
  /** Raw `globalDependencies`, when present. */
  globalDependencies: string[];
  /** True if the modern `tasks` key was used. */
  modern: boolean;
}

/** Parse a (possibly malformed) turbo.json object. Never throws. */
export function parseTurboConfig(json: unknown): TurboConfig {
  const obj = (json && typeof json === "object" ? json : {}) as Record<
    string,
    unknown
  >;
  const tasksObj = obj.tasks ?? obj.pipeline;
  const tasks =
    tasksObj && typeof tasksObj === "object"
      ? Object.keys(tasksObj as Record<string, unknown>)
      : [];
  const globalDependencies = Array.isArray(obj.globalDependencies)
    ? (obj.globalDependencies as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  return { tasks, globalDependencies, modern: "tasks" in obj };
}

const CONFIG_NAME_RE =
  /(^|\/)((eslint|prettier|tsconfig|jest|vitest|tailwind|babel)[-.]?config|config)($|[-/])/i;

/**
 * Classify a package the Turborepo way:
 *  - `app`    — private, has a start/dev/serve script or is under apps/.
 *  - `tool`   — exposes a bin (a CLI).
 *  - `config` — a shared config package (eslint-config, tsconfig, …).
 *  - `package`— a published/consumable library.
 *  - `unknown`— not enough signal.
 */
export function classifyTurboPackage(pkg: PackageInfo): TurboPackageClass {
  const name = pkg.name ?? "";
  const root = pkg.root.replace(/\\/g, "/");
  const scripts = pkg.scripts ?? {};
  const manifest = pkg.manifest;

  if (manifest.bin) return "tool";
  if (
    CONFIG_NAME_RE.test(name) ||
    /-config$/.test(name) ||
    /(^|\/)config\//.test(root)
  )
    return "config";
  if (
    /(^|\/)apps\//.test(root) ||
    ((pkg.private || manifest.private) &&
      (scripts.start || scripts.dev || scripts.serve))
  )
    return "app";
  if (
    manifest.exports ||
    manifest.main ||
    manifest.module ||
    manifest.types ||
    manifest.typings
  )
    return "package";
  if (/(^|\/)packages\//.test(root)) return "package";
  return "unknown";
}

/** Tally a workspace's packages by their Turborepo class. */
export function classifyPackages(
  packages: PackageInfo[],
): Record<TurboPackageClass, number> {
  const tally: Record<TurboPackageClass, number> = {
    app: 0,
    package: 0,
    tool: 0,
    config: 0,
    unknown: 0,
  };
  for (const p of packages) tally[classifyTurboPackage(p)]++;
  return tally;
}
