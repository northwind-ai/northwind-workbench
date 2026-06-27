import type { PackageManager } from "@package-workbench/plugin-sdk";
import { workspaceAdapters } from "./adapters";
import {
  ALL_CAPABILITIES,
  type AdapterId,
  type WorkspaceCapability,
  type WorkspaceDetectionResult,
  type WorkspaceScanResult,
  type WorkspaceStack,
} from "./types";

/**
 * The adapter registry: runs every adapter's detector, then resolves the
 * results into a single {@link WorkspaceStack} — a primary adapter plus the
 * *combined* capabilities of everything that matched.
 *
 * Precedence (highest wins as primary):
 *   nx (90) > turbo (80) > pnpm (70) > yarn (60) > bun (55) > npm (50) > single-package (10)
 *
 * Combination is the point: an Nx-on-pnpm repo lists pnpm AND nx, taking the
 * project graph from Nx and the package list from pnpm. A single-package repo is
 * only "primary single-package" when no real workspace lister matched, even if a
 * package-manager lockfile is present.
 */

const HUMAN_CAP: Record<WorkspaceCapability, string> = {
  "package-list": "workspace package list",
  "project-graph": "project graph",
  "task-pipeline": "task pipeline",
  "package-manager": "package manager",
  "dependency-constraints": "dependency constraints",
};

export async function detectAll(
  cwd: string,
): Promise<WorkspaceDetectionResult[]> {
  const all = await Promise.all(
    workspaceAdapters.map((a) => a.detect(cwd).catch(() => failed(a.id))),
  );
  return all;
}

function failed(adapter: AdapterId): WorkspaceDetectionResult {
  return {
    adapter,
    detected: false,
    confidence: 0,
    evidence: ["detection failed"],
    capabilities: [],
  };
}

const precedenceOf = (id: AdapterId): number =>
  workspaceAdapters.find((a) => a.id === id)?.precedence ?? 0;

/** Resolve a workspace's full adapter stack. Never throws. */
export async function detectWorkspaceStack(
  cwd: string,
): Promise<WorkspaceStack> {
  const results = await detectAll(cwd);
  const detected = results
    .filter((r) => r.detected)
    .sort((a, b) => precedenceOf(b.adapter) - precedenceOf(a.adapter));

  // Capability → providers (attributed, precedence-ordered).
  const capabilities: Partial<Record<WorkspaceCapability, AdapterId[]>> = {};
  for (const r of detected) {
    for (const cap of r.capabilities) {
      (capabilities[cap] ??= []).push(r.adapter);
    }
  }

  // Is there a *workspace* package lister (anything but single-package)?
  const workspaceListers = detected.filter(
    (r) =>
      r.adapter !== "single-package" && r.capabilities.includes("package-list"),
  );
  const single = detected.find((r) => r.adapter === "single-package");
  const isSinglePackage = workspaceListers.length === 0 && Boolean(single);

  // Primary: single-package when it's truly single; otherwise highest precedence.
  const primaryResult = isSinglePackage ? single! : detected[0];
  const primary: AdapterId = primaryResult?.adapter ?? "single-package";

  // Package manager: the first detected adapter that implies one, else unknown.
  const packageManager: PackageManager =
    detected.find((r) => r.packageManager)?.packageManager ?? "unknown";

  return {
    primary,
    detected,
    capabilities,
    packageManager,
    confidence: primaryResult?.confidence ?? 0,
    isSinglePackage,
    notes: buildNotes(detected, capabilities, packageManager, isSinglePackage),
  };
}

function buildNotes(
  detected: WorkspaceDetectionResult[],
  capabilities: Partial<Record<WorkspaceCapability, AdapterId[]>>,
  packageManager: PackageManager,
  isSinglePackage: boolean,
): string[] {
  const notes: string[] = [];

  // Unsupported capabilities (relative to a full monorepo toolchain).
  for (const cap of ALL_CAPABILITIES) {
    if (cap === "dependency-constraints") continue; // optional everywhere
    if (!capabilities[cap]?.length) {
      if (cap === "project-graph")
        notes.push(
          "No project-graph source (e.g. Nx) — the dependency graph is inferred from source imports.",
        );
      else if (cap === "package-manager" && packageManager === "unknown")
        notes.push(
          "Could not determine the package manager — add a lockfile to make detection deterministic.",
        );
      else if (cap === "task-pipeline" && !isSinglePackage)
        notes.push(
          "No task pipeline (Nx/Turborepo) — build ordering is not modelled.",
        );
    }
  }

  // Turborepo without a package-list provider can't enumerate packages on its own.
  const hasTurbo = detected.some((r) => r.adapter === "turbo");
  const hasLister = (capabilities["package-list"]?.length ?? 0) > 0;
  if (hasTurbo && !hasLister) {
    notes.push(
      "Turborepo detected without a package-manager workspace — add a `workspaces` field or pnpm-workspace.yaml so packages can be enumerated.",
    );
  }

  if (isSinglePackage)
    notes.push(
      "Single-package mode — the root package.json is analyzed as one package.",
    );

  return notes;
}

/** Scan a workspace using the resolved primary adapter. */
export async function scanWithAdapters(
  cwd: string,
): Promise<WorkspaceScanResult> {
  const stack = await detectWorkspaceStack(cwd);
  const adapter =
    workspaceAdapters.find((a) => a.id === stack.primary) ??
    workspaceAdapters.find((a) => a.id === "single-package")!;
  return adapter.scan(cwd);
}

/** Human, one-line summary of a detection stack (for the CLI/UI header). */
export function explainStack(stack: WorkspaceStack): string {
  const parts = stack.detected.map(
    (r) =>
      workspaceAdapters.find((a) => a.id === r.adapter)?.title ?? r.adapter,
  );
  const caps = Object.keys(stack.capabilities)
    .map((c) => HUMAN_CAP[c as WorkspaceCapability])
    .join(", ");
  return `${parts.join(" + ") || "unknown"} · ${stack.packageManager} · ${caps}`;
}
