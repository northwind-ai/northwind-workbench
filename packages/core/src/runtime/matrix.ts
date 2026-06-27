import type {
  ImportExecutionResult,
  PackageInfo,
  RuntimeCompatibilityReport,
  RuntimeMatrix,
  RuntimeStatus,
  RuntimeTarget,
  RuntimeTargetReport,
} from "@package-workbench/plugin-sdk";
import {
  analyzeBrowserCompat,
  type BrowserCompatReport,
} from "./browser-compat";
import { detectRuntime } from "./detect";
import { validateExports, type ExportsValidation } from "./exports";
import { resolvePrimaryEntry } from "./resolve";
import { executeImport } from "./sandbox";

/**
 * The runtime engine's top-level orchestrator. Combines detection, browser
 * analysis, export validation, and (optionally) real sandboxed imports into a
 * single {@link RuntimeCompatibilityReport} with a 5-target matrix.
 *
 * Designed to never throw and to degrade gracefully: with `execute: false` it is
 * fully static (no child processes) — the right mode for scanning large
 * monorepos quickly; with `execute: true` it additionally runs the Node imports.
 */

export interface BuildRuntimeReportOptions {
  /** Actually import the package in a child Node process. Default: true. */
  execute?: boolean;
  /** Per-import timeout. Default: 10s. */
  timeoutMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

/** Derive a node target's cell, honouring whether it's an intended target. */
function nodeCell(
  target: RuntimeTarget,
  intended: boolean,
  exec: ImportExecutionResult | null,
  staticResolvable: boolean,
): RuntimeTargetReport {
  if (exec) {
    if (exec.ok) {
      return {
        target,
        status: "pass",
        intended,
        reason: `Imported successfully (${exec.exportedKeys?.length ?? 0} export(s))`,
        execution: exec,
      };
    }
    // A real failure only counts against intended targets; otherwise it's informational.
    const status: RuntimeStatus = intended ? "fail" : "unknown";
    const prefix = intended ? "" : "Not an intended target — ";
    return {
      target,
      status,
      intended,
      reason: `${prefix}${exec.failureClass}: ${exec.message}`,
      execution: exec,
      evidence: exec.stack
        ? [exec.stack]
        : exec.offendingFile
          ? [exec.offendingFile]
          : undefined,
    };
  }
  // Static-only path.
  if (!intended)
    return {
      target,
      status: "unknown",
      intended,
      reason: "Not an intended target; not executed",
    };
  if (staticResolvable)
    return {
      target,
      status: "pass",
      intended,
      reason: "Entry resolves on disk (static check; not executed)",
    };
  return {
    target,
    status: "fail",
    intended,
    reason: "No resolvable entry point for this module system",
  };
}

/** Derive the browser cell from static analysis. */
function browserCell(
  intended: boolean,
  browser: BrowserCompatReport,
): RuntimeTargetReport {
  if (browser.hardBreakers.length > 0) {
    const status: RuntimeStatus = intended ? "fail" : "unknown";
    return {
      target: "browser",
      status,
      intended,
      reason: `Uses Node built-ins with no browser equivalent: ${browser.hardBreakers.join(", ")}`,
      evidence: browser.usages
        .filter((u) => u.impact === "hard")
        .flatMap((u) => u.files.map((f) => `${u.name} → ${f}`)),
    };
  }
  if (!intended)
    return {
      target: "browser",
      status: "unknown",
      intended,
      reason: "Not a browser target",
    };
  if (browser.usages.length > 0) {
    return {
      target: "browser",
      status: "warn",
      intended,
      reason: `Uses polyfillable Node built-ins (${browser.usages.map((u) => u.name).join(", ")}) — needs a bundler shim`,
    };
  }
  return {
    target: "browser",
    status: "pass",
    intended,
    reason: `No Node built-ins found in ${browser.filesScanned} source file(s) (static)`,
  };
}

function rollupNode(cells: RuntimeTargetReport[]): RuntimeStatus {
  const execed = cells.filter((c) => c.execution);
  if (execed.some((c) => c.execution!.ok)) return "pass";
  if (execed.length > 0) return "fail";
  if (cells.some((c) => c.status === "pass")) return "pass";
  return "unknown";
}

/** Build the full runtime compatibility report for one package. */
export async function buildRuntimeReport(
  pkg: PackageInfo,
  opts: BuildRuntimeReportOptions = {},
): Promise<RuntimeCompatibilityReport> {
  const execute = opts.execute ?? true;
  const now = opts.now ?? (() => new Date().toISOString());

  const browser = await analyzeBrowserCompat(pkg);
  const detection = detectRuntime(pkg, browser.hardBreakers);
  const exportsVal: ExportsValidation = await validateExports(pkg);

  const intended = new Set(detection.intended);
  const electronish =
    detection.primary === "electron" ||
    detection.signals.some((s) => s.points === "electron");

  // ---- Node targets (CJS + ESM) ---------------------------------------------
  const nodeCells: RuntimeTargetReport[] = [];
  for (const [target, system] of [
    ["node_cjs", "cjs"],
    ["node_esm", "esm"],
  ] as const) {
    const isIntended = intended.has(target);
    let exec: ImportExecutionResult | null = null;
    let staticResolvable = false;
    // Execute only when meaningful: it's an intended target and execution is on.
    if (execute && isIntended) {
      exec = await executeImport(pkg, system, { timeoutMs: opts.timeoutMs });
    } else {
      staticResolvable = (await resolvePrimaryEntry(pkg, system)) != null;
    }
    nodeCells.push(nodeCell(target, isIntended, exec, staticResolvable));
  }

  const cjs = nodeCells[0]!;
  const esm = nodeCells[1]!;
  const browserReport = browserCell(intended.has("browser"), browser);
  const nodeRollup = rollupNode(nodeCells);

  const electronMain: RuntimeTargetReport = {
    target: "electron_main",
    status: electronish ? nodeRollup : "unknown",
    intended: electronish,
    reason: electronish
      ? `Electron main runs Node — mirrors Node result (${nodeRollup})`
      : "Not an Electron app/dependency",
  };
  const rendererIntended = electronish || intended.has("electron_renderer");
  const electronRenderer: RuntimeTargetReport = {
    target: "electron_renderer",
    status: rendererIntended ? browserReport.status : "unknown",
    intended: rendererIntended,
    reason: rendererIntended
      ? `Electron renderer is Chromium — mirrors browser result (${browserReport.status})`
      : "Not an Electron renderer target",
  };

  const targets: RuntimeTargetReport[] = [
    cjs,
    esm,
    browserReport,
    electronRenderer,
    electronMain,
  ];
  const matrix = targets.reduce((acc, t) => {
    acc[t.target] = t.status;
    return acc;
  }, {} as RuntimeMatrix);

  return {
    packageId: pkg.id,
    matrix,
    targets,
    detection,
    nodeBuiltinsUsed: browser.usages.map((u) => u.name),
    resolution: exportsVal.resolution,
    generatedAt: now(),
  };
}
