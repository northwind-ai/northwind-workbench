import type {
  ModuleResolutionReport,
  PackageInfo,
} from "@package-workbench/plugin-sdk";
import { classifyFormat, pathExists, resolveTarget } from "./resolve";

/**
 * Export + entry validation. Proves that what a package *advertises* it actually
 * ships: `main`/`module`/`types` resolve to real files, and the `exports` map is
 * structurally valid (no mixed key styles, no missing targets, no escapes). All
 * static — no execution.
 */

export type ExportsIssueSeverity = "high" | "medium" | "low";

export interface ExportsIssue {
  severity: ExportsIssueSeverity;
  message: string;
  /** The exports subpath/condition the issue concerns, when applicable. */
  at?: string;
}

export interface ExportsValidation {
  hasExportsField: boolean;
  /** False if any high-severity structural issue was found. */
  valid: boolean;
  issues: ExportsIssue[];
  /** Resolution outcome for every declared, statically-resolvable target. */
  resolution: ModuleResolutionReport[];
}

const KNOWN_CONDITIONS = new Set([
  "import",
  "require",
  "node",
  "browser",
  "default",
  "types",
  "typings",
  "development",
  "production",
  "deno",
  "worker",
  "edge-light",
  "react-native",
  "module",
]);

interface TargetRef {
  at: string;
  target: string;
}

/** Recursively collect every string target in an `exports` value, with its path. */
function collectTargets(
  node: unknown,
  at: string,
  out: TargetRef[],
  issues: ExportsIssue[],
): void {
  if (typeof node === "string") {
    out.push({ at, target: node });
    if (!node.startsWith("./") && node !== ".") {
      issues.push({
        severity: "high",
        message: `Export target must be a relative path starting with "./" (got "${node}")`,
        at,
      });
    }
    return;
  }
  if (node === null) return; // explicit "block this subpath" — valid
  if (!node || typeof node !== "object") {
    issues.push({
      severity: "high",
      message: `Invalid export value (expected string, object, or null)`,
      at,
    });
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const childAt = key.startsWith(".")
      ? `${at}${key === "." ? "" : key.slice(1)}`
      : `${at} › ${key}`;
    if (!key.startsWith(".") && !KNOWN_CONDITIONS.has(key)) {
      issues.push({
        severity: "low",
        message: `Unknown export condition "${key}" (allowed, but most tools ignore it)`,
        at,
      });
    }
    collectTargets(value, childAt, out, issues);
  }
}

/** Validate `exports`, `main`, `module`, and `types` for one package. */
export async function validateExports(
  pkg: PackageInfo,
): Promise<ExportsValidation> {
  const m = pkg.manifest;
  const issues: ExportsIssue[] = [];
  const resolution: ModuleResolutionReport[] = [];
  const hasExportsField = m.exports != null;

  // ---- exports map structure -------------------------------------------------
  if (hasExportsField && typeof m.exports === "object" && m.exports !== null) {
    const topKeys = Object.keys(m.exports as Record<string, unknown>);
    const subpathKeys = topKeys.filter((k) => k.startsWith("."));
    const conditionKeys = topKeys.filter((k) => !k.startsWith("."));
    if (subpathKeys.length > 0 && conditionKeys.length > 0) {
      issues.push({
        severity: "high",
        message:
          'exports mixes subpath keys ("./x") and condition keys ("import") at the top level — Node forbids this',
      });
    }
  }

  const targets: TargetRef[] = [];
  if (hasExportsField) collectTargets(m.exports, ".", targets, issues);

  // ---- resolve exports targets ----------------------------------------------
  for (const { at, target } of dedupeTargets(targets)) {
    if (target.includes("*")) continue; // pattern subpath — can't statically resolve
    resolution.push(await resolveOne(pkg, target, at));
  }

  // ---- main / module / types -------------------------------------------------
  for (const field of ["main", "module"] as const) {
    const rel = m[field];
    if (typeof rel === "string")
      resolution.push(await resolveOne(pkg, rel, field));
  }
  const typesField = m.types ?? m.typings;
  if (typeof typesField === "string")
    resolution.push(await resolveOne(pkg, typesField, "types"));

  // ---- consistency notes -----------------------------------------------------
  for (const r of resolution) {
    if (!r.resolved) {
      issues.push({
        severity: "high",
        message: `Declared target does not exist: ${r.specifier}`,
        at: r.specifier,
      });
    }
  }
  const declaresTypes =
    typeof typesField === "string" ||
    targets.some((t) => t.at.includes("types"));
  const isLibrary =
    pkg.packageType === "library" ||
    hasExportsField ||
    typeof m.main === "string";
  if (isLibrary && !declaresTypes) {
    issues.push({
      severity: "medium",
      message:
        'No "types"/"typings" field or types condition — TypeScript consumers get no types',
    });
  }

  const valid = !issues.some((i) => i.severity === "high");
  return { hasExportsField, valid, issues, resolution };
}

function dedupeTargets(targets: TargetRef[]): TargetRef[] {
  const seen = new Set<string>();
  const out: TargetRef[] = [];
  for (const t of targets) {
    if (seen.has(t.target)) continue;
    seen.add(t.target);
    out.push(t);
  }
  return out;
}

async function resolveOne(
  pkg: PackageInfo,
  target: string,
  at: string,
): Promise<ModuleResolutionReport> {
  const abs = resolveTarget(pkg, target);
  if (!abs) {
    return {
      specifier: target,
      resolved: false,
      error: `"${at}" target escapes the package root or is absolute`,
      failureClass: "EXPORT_RESOLUTION_FAILURE",
    };
  }
  if (await pathExists(abs)) {
    return {
      specifier: target,
      resolved: true,
      resolvedPath: abs,
      format: classifyFormat(abs, pkg.manifest),
    };
  }
  return {
    specifier: target,
    resolved: false,
    error: `"${at}" points at a file that does not exist`,
    failureClass: "EXPORT_RESOLUTION_FAILURE",
  };
}
