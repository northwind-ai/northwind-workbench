import type {
  PackageInfo,
  PackageManager,
  WorkspaceInfo,
} from "@package-workbench/plugin-sdk";

/**
 * The workspace-adapter contract. An adapter knows how to *detect* one flavour of
 * workspace (pnpm, npm, yarn, bun, Nx, Turborepo, or a single package), *explain*
 * why it matched, declare its *capabilities*, and *scan* it into the common
 * package model.
 *
 * Repos frequently match several adapters at once (pnpm + Nx, pnpm + Turbo). The
 * registry resolves a primary by precedence and *combines* capabilities — so an
 * Nx-on-pnpm repo gets Nx's project graph AND pnpm's package list.
 *
 * Pure types only; the detectors live alongside in `@package-workbench/core`.
 */

export type AdapterId =
  | "nx"
  | "turbo"
  | "pnpm"
  | "yarn"
  | "bun"
  | "npm"
  | "single-package";

/** A discrete thing an adapter can provide to the engine. */
export type WorkspaceCapability =
  | "package-list" // can enumerate the workspace's packages
  | "project-graph" // contributes an explicit project/dependency graph
  | "task-pipeline" // defines a task pipeline (build/test/lint ordering)
  | "package-manager" // identifies the package manager / lockfile
  | "dependency-constraints"; // boundary rules / module tags

export const ALL_CAPABILITIES: readonly WorkspaceCapability[] = [
  "package-list",
  "project-graph",
  "task-pipeline",
  "package-manager",
  "dependency-constraints",
] as const;

/** The outcome of one adapter's `detect()`. */
export interface WorkspaceDetectionResult {
  adapter: AdapterId;
  detected: boolean;
  /** 0..1 — how strongly the signals point at this adapter. */
  confidence: number;
  /** Human evidence, e.g. `found turbo.json`, `packageManager: pnpm@9`. */
  evidence: string[];
  /** Capabilities this adapter would contribute if used. */
  capabilities: WorkspaceCapability[];
  /** The package manager this adapter implies, when it implies one. */
  packageManager?: PackageManager;
}

/** Adapter scan output — the common package model the rest of the engine uses. */
export interface WorkspaceScanResult {
  workspace: WorkspaceInfo;
  packages: PackageInfo[];
}

/** A workspace adapter: detect + explain + scan + capabilities. */
export interface WorkspaceAdapter {
  id: AdapterId;
  title: string;
  /** Higher wins when several adapters match (the "primary"). */
  precedence: number;
  /** Capabilities this adapter can provide (static; `detect` may narrow them). */
  capabilities: WorkspaceCapability[];
  detect(cwd: string): Promise<WorkspaceDetectionResult>;
  /** One-line, human explanation of a detection result. */
  explainDetection(result: WorkspaceDetectionResult): string;
  scan(cwd: string): Promise<WorkspaceScanResult>;
}

/**
 * The resolved adapter stack for a workspace: the primary adapter, every adapter
 * that matched, the union of capabilities (attributed to their providers), and
 * advisory notes (unsupported features / suggested fixes).
 */
export interface WorkspaceStack {
  /** The highest-precedence detected adapter (drives the package scan). */
  primary: AdapterId;
  /** Every adapter that matched, precedence-ordered. */
  detected: WorkspaceDetectionResult[];
  /** Capability → the adapter(s) providing it. */
  capabilities: Partial<Record<WorkspaceCapability, AdapterId[]>>;
  packageManager: PackageManager;
  /** Confidence of the primary detection, 0..1. */
  confidence: number;
  /** True when the repo is a single package (no workspace). */
  isSinglePackage: boolean;
  /** Advisory notes: unsupported capabilities + suggested fixes. */
  notes: string[];
}

/** Turborepo package classification (richer than the generic PackageType). */
export type TurboPackageClass =
  | "app"
  | "package"
  | "tool"
  | "config"
  | "unknown";
