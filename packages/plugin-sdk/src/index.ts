/**
 * @package-workbench/plugin-sdk
 *
 * The public contract for Package Workbench. Zero runtime dependencies and no
 * Node imports on purpose: this is the stable surface that plugins (and the app
 * itself) depend on, and its pure helpers must be safe to bundle anywhere. These
 * atoms are re-exported from `@package-workbench/core`.
 */

// ---- Workspace / package model ----------------------------------------------

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

/** Where a package is intended to run — drives which checks make sense. */
export type PackageRuntime = 'node' | 'browser' | 'electron' | 'universal' | 'edge' | 'deno' | 'unknown';

/** The role a package plays in the repo. */
export type PackageType = 'app' | 'library' | 'tool' | 'unknown';

/** Minimal, structurally-typed view of a package.json. */
export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  type?: 'module' | 'commonjs';
  main?: string;
  module?: string;
  browser?: string | Record<string, unknown>;
  types?: string;
  typings?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  workspaces?: string[] | { packages?: string[] };
  [key: string]: unknown;
}

/** A single package discovered in a workspace. */
export interface PackageInfo {
  /** Stable identity, usually the package name (falls back to dir name). */
  id: string;
  name: string;
  version: string;
  /** Absolute path to the package root (the dir containing package.json). */
  root: string;
  /** Absolute path to the package.json itself. */
  packageJsonPath: string;
  private: boolean;
  packageType: PackageType;
  runtime: PackageRuntime;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  manifest: PackageManifest;
  /** False if package.json existed but could not be parsed. */
  manifestValid: boolean;
  /** Non-fatal problems found while scanning this package. */
  warnings: string[];
}

export interface WorkspaceTooling {
  packageJson: boolean;
  pnpmWorkspace: boolean;
  nx: boolean;
  turbo: boolean;
  tsconfigBase: boolean;
}

/** Metadata about the workspace as a whole. */
export interface WorkspaceInfo {
  root: string;
  name?: string;
  packageManager: PackageManager;
  isMonorepo: boolean;
  packageCount: number;
  tooling: WorkspaceTooling;
  /** Non-fatal problems found while scanning the workspace. */
  warnings: string[];
}

// ---- Health check model ------------------------------------------------------

export type HealthCheckStatus = 'pass' | 'warn' | 'fail' | 'skip' | 'unknown';

/** How damaging a failing/warning check is. Drives scoring weight. */
export type HealthCheckSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * The outcome a check returns. The runner enriches this into a full
 * `HealthCheckResult` by attaching `checkId`, `label`, and `durationMs`.
 */
export interface HealthCheckOutcome {
  status: HealthCheckStatus;
  severity: HealthCheckSeverity;
  summary: string;
  details?: string;
  evidence?: string[];
}

export interface HealthCheckResult extends HealthCheckOutcome {
  checkId: string;
  label: string;
  durationMs?: number;
}

// ---- Host capabilities injected into plugins --------------------------------

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Capabilities the host injects into plugins. Plugins must NOT import `node:fs`
 * or `node:child_process` directly — going through the context keeps them
 * portable and lets the host sandbox these calls in a future isolated process.
 */
export interface PluginContext {
  readonly cwd: string;
  readonly logger: Logger;
  exec(command: string, opts: ExecOptions): Promise<ExecResult>;
  readJson<T = unknown>(absPath: string): Promise<T | null>;
  fileExists(absPath: string): Promise<boolean>;
  readDir(absPath: string): Promise<string[]>;
}

// ---- Extension points --------------------------------------------------------

/** Everything a check needs to evaluate one package. */
export interface CheckContext {
  package: PackageInfo;
  workspace: WorkspaceInfo;
  host: PluginContext;
}

/** A single health check. Return `skip`/`unknown` when not applicable. */
export interface HealthCheck {
  id: string;
  label: string;
  description: string;
  /** Default severity for this check's failures (results may override). */
  severity: HealthCheckSeverity;
  /** Relative weight in the aggregate score. Default 1. */
  weight?: number;
  run(ctx: CheckContext): Promise<HealthCheckOutcome>;
}

/** Detects and enumerates packages for a workspace flavor (npm/pnpm/nx/...). */
export interface WorkspaceAdapter {
  id: string;
  title: string;
  detect(cwd: string, ctx: PluginContext): Promise<boolean>;
  listPackages(cwd: string, ctx: PluginContext): Promise<PackageInfo[]>;
}

/** The unit of extension. Contributes adapters and/or checks. */
export interface Plugin {
  name: string;
  version?: string;
  adapters?: WorkspaceAdapter[];
  checks?: HealthCheck[];
  setup?(ctx: PluginContext): void | Promise<void>;
}

// ---- Identity helpers (type inference + stable, evolvable signatures) --------

export const definePlugin = (plugin: Plugin): Plugin => plugin;
export const defineCheck = (check: HealthCheck): HealthCheck => check;
export const defineAdapter = (adapter: WorkspaceAdapter): WorkspaceAdapter => adapter;

// ---- Outcome constructors (ergonomics for check authors) ---------------------

type OutcomeExtra = Partial<Pick<HealthCheckOutcome, 'details' | 'evidence'>>;

export const pass = (summary: string, extra: OutcomeExtra = {}): HealthCheckOutcome => ({
  status: 'pass',
  severity: 'info',
  summary,
  ...extra,
});

export const skip = (summary: string, extra: OutcomeExtra = {}): HealthCheckOutcome => ({
  status: 'skip',
  severity: 'info',
  summary,
  ...extra,
});

export const unknown = (summary: string, extra: OutcomeExtra = {}): HealthCheckOutcome => ({
  status: 'unknown',
  severity: 'info',
  summary,
  ...extra,
});

export const warn = (severity: HealthCheckSeverity, summary: string, extra: OutcomeExtra = {}): HealthCheckOutcome => ({
  status: 'warn',
  severity,
  summary,
  ...extra,
});

export const fail = (severity: HealthCheckSeverity, summary: string, extra: OutcomeExtra = {}): HealthCheckOutcome => ({
  status: 'fail',
  severity,
  summary,
  ...extra,
});

// ---- Pure helpers (no Node imports — safe to bundle anywhere) ----------------

const has = (obj: Record<string, string> | undefined, key: string): boolean => Boolean(obj && key in obj);

/** Infer a package's intended runtime from its manifest. */
export function inferRuntime(manifest: PackageManifest): PackageRuntime {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  if (has(deps, 'electron')) return 'electron';
  if (manifest.browser != null) return 'browser';

  const exportsObj = manifest.exports;
  if (exportsObj && typeof exportsObj === 'object') {
    const json = JSON.stringify(exportsObj);
    if (json.includes('"browser"')) return 'browser';
    if (json.includes('"edge') || json.includes('worker')) return 'edge';
  }

  if (has(deps, 'react') || has(deps, 'react-dom') || has(deps, 'vue') || has(deps, 'svelte') || has(deps, '@angular/core')) {
    return 'browser';
  }
  if (manifest.bin || manifest.engines?.node) return 'node';
  if (manifest.main || manifest.module || manifest.exports) return 'universal';
  return 'unknown';
}

/** Infer whether a package is an app, a library, a tool, or unknown. */
export function inferPackageType(manifest: PackageManifest): PackageType {
  if (manifest.bin) return 'tool';
  if (manifest.exports || manifest.main || manifest.module || manifest.types || manifest.typings) return 'library';
  const scripts = manifest.scripts ?? {};
  if (scripts.start || scripts.dev || (manifest.private && scripts.build)) return 'app';
  return 'unknown';
}

export interface AssemblePackageInfoInput {
  root: string;
  packageJsonPath: string;
  manifest: PackageManifest;
  manifestValid?: boolean;
  warnings?: string[];
  /** Fallback id/name when the manifest has no name (e.g. directory name). */
  fallbackName?: string;
}

/** Pure constructor for PackageInfo — shared by the core scanner and plugins. */
export function assemblePackageInfo(input: AssemblePackageInfoInput): PackageInfo {
  const { root, packageJsonPath, manifest } = input;
  const name = manifest.name ?? input.fallbackName ?? root;
  return {
    id: name,
    name,
    version: manifest.version ?? '0.0.0',
    root,
    packageJsonPath,
    private: manifest.private === true,
    packageType: inferPackageType(manifest),
    runtime: inferRuntime(manifest),
    scripts: manifest.scripts ?? {},
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    manifest,
    manifestValid: input.manifestValid ?? true,
    warnings: input.warnings ?? [],
  };
}
