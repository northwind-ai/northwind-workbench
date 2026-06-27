/**
 * Runtime compatibility model — the vocabulary for "does this package actually
 * load and run in environment X?". Pure types + tiny pure helpers only (this
 * file, like the rest of the SDK, must be safe to bundle into a browser). The
 * heavy lifting (detection, sandboxed import execution) lives in
 * `@package-workbench/core`; this is the shared contract its results conform to.
 */

import type { PackageRuntime } from "./index";

/** The concrete environments a package can be checked against. */
export type RuntimeTarget =
  | "node_cjs"
  | "node_esm"
  | "browser"
  | "electron_renderer"
  | "electron_main";

/** Canonical ordering — used by the CLI/UI so the matrix always renders the same. */
export const RUNTIME_TARGETS: readonly RuntimeTarget[] = [
  "node_cjs",
  "node_esm",
  "browser",
  "electron_renderer",
  "electron_main",
] as const;

/** Human label for each target (UI + CLI). */
export const RUNTIME_TARGET_LABEL: Record<RuntimeTarget, string> = {
  node_cjs: "Node CJS",
  node_esm: "Node ESM",
  browser: "Browser",
  electron_renderer: "Electron Renderer",
  electron_main: "Electron Main",
};

/**
 * Per-target verdict.
 *  - `pass`    — verified to load/run (or statically safe).
 *  - `fail`    — verified to break.
 *  - `warn`    — likely-but-unproven problem (e.g. Node built-ins in a browser lib).
 *  - `unknown` — not enough signal / not executed (e.g. needs a real browser).
 */
export type RuntimeStatus = "pass" | "fail" | "warn" | "unknown";

/** A package's compatibility matrix: one verdict per runtime target. */
export type RuntimeMatrix = Record<RuntimeTarget, RuntimeStatus>;

/** Stable classification of *why* an import failed. Drives messaging + scoring. */
export type ImportFailureClass =
  | "IMPORT_RESOLUTION_FAILURE"
  | "MISSING_DEPENDENCY"
  | "ESM_CJS_MISMATCH"
  | "RUNTIME_EXCEPTION"
  | "SYNTAX_FAILURE"
  | "EXPORT_RESOLUTION_FAILURE";

/** The result of trying to resolve a single module specifier. */
export interface ModuleResolutionReport {
  /** What we tried to resolve (a path or a bare specifier). */
  specifier: string;
  resolved: boolean;
  /** Absolute path it resolved to, when it resolved. */
  resolvedPath?: string;
  /** How the resolved file would be interpreted, when known. */
  format?: "esm" | "cjs" | "json" | "unknown";
  /** Why resolution failed, when it failed. */
  error?: string;
  failureClass?: ImportFailureClass;
}

/** The result of actually importing/executing a package entry in a sandbox. */
export interface ImportExecutionResult {
  target: RuntimeTarget;
  /** The file (or package root) we attempted to load. */
  entry: string;
  ok: boolean;
  /** Wall-clock time of the child process, in ms. */
  durationMs: number;
  /** Exported symbol names captured on success (best effort). */
  exportedKeys?: string[];
  /** Present only on failure. */
  failureClass?: ImportFailureClass;
  errorType?: string;
  message?: string;
  stack?: string;
  /** First package-owned frame from the stack, when derivable. */
  offendingFile?: string;
  /** The bare specifier that could not be found, for MISSING_DEPENDENCY. */
  missingModule?: string;
  /** True when the child was killed by the timeout. */
  timedOut?: boolean;
}

/** A weighted clue about where a package is meant to run. */
export interface RuntimeSignal {
  /** Where the clue came from: `dependencies`, `imports`, `browser-field`, … */
  source: string;
  /** Which runtime the clue points at. */
  points: PackageRuntime;
  /** Relative strength of the clue (higher = stronger). */
  weight: number;
  detail: string;
}

/** The outcome of inferring a package's intended runtime(s). */
export interface RuntimeDetectionReport {
  /** Coarse primary runtime (node/browser/electron/universal/…). */
  primary: PackageRuntime;
  /** The concrete targets we believe the package is *meant* to support. */
  intended: RuntimeTarget[];
  /** 0..1 — how strongly the signals agree. */
  confidence: number;
  signals: RuntimeSignal[];
}

/** Per-target detail behind a matrix cell. */
export interface RuntimeTargetReport {
  target: RuntimeTarget;
  status: RuntimeStatus;
  /** Whether the package is even meant to target this runtime. */
  intended: boolean;
  reason: string;
  /** Set when this verdict came from actually importing the package. */
  execution?: ImportExecutionResult;
  evidence?: string[];
}

/** The full runtime compatibility report for one package. */
export interface RuntimeCompatibilityReport {
  packageId: string;
  /** The compatibility matrix — one verdict per target. */
  matrix: RuntimeMatrix;
  targets: RuntimeTargetReport[];
  detection: RuntimeDetectionReport;
  /** Node built-ins found in source that would break in a browser. */
  nodeBuiltinsUsed: string[];
  /** Module-resolution findings for declared entries. */
  resolution: ModuleResolutionReport[];
  generatedAt: string;
}

// ---- Pure helpers ------------------------------------------------------------

/** Worst-wins reduction over per-target statuses (`fail` > `warn` > `unknown` > `pass`). */
export function rollupRuntimeStatus(statuses: RuntimeStatus[]): RuntimeStatus {
  if (statuses.some((s) => s === "fail")) return "fail";
  if (statuses.some((s) => s === "warn")) return "warn";
  if (statuses.length > 0 && statuses.every((s) => s === "pass")) return "pass";
  return "unknown";
}

/** Build an all-`unknown` matrix — the safe default before anything is evaluated. */
export function emptyRuntimeMatrix(): RuntimeMatrix {
  return {
    node_cjs: "unknown",
    node_esm: "unknown",
    browser: "unknown",
    electron_renderer: "unknown",
    electron_main: "unknown",
  };
}
