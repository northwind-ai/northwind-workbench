import { join } from "node:path";
import type {
  PackageManager,
  PackageManifest,
} from "@package-workbench/plugin-sdk";
import { scanWorkspace } from "../scanner";
import { listDirNames, pathExists, readJsonSafe, readText } from "./fsx";
import { parseTurboConfig } from "./turbo";
import type {
  AdapterId,
  WorkspaceAdapter,
  WorkspaceCapability,
  WorkspaceDetectionResult,
  WorkspaceScanResult,
} from "./types";

/**
 * The seven concrete workspace adapters. Detection reads only declarative
 * signals (lock files, config files, the `workspaces` field, `packageManager`),
 * so it is fast, offline, and install-free. Every adapter's `scan()` delegates
 * to the hardened {@link scanWorkspace} — one source of truth for package
 * discovery that already never crashes on a malformed repo — so adapters add
 * detection + capabilities + explanation without duplicating traversal.
 */

const result = (
  adapter: AdapterId,
  detected: boolean,
  confidence: number,
  evidence: string[],
  capabilities: WorkspaceCapability[],
  packageManager?: PackageManager,
): WorkspaceDetectionResult => ({
  adapter,
  detected,
  confidence,
  evidence,
  capabilities,
  packageManager,
});

async function scan(cwd: string): Promise<WorkspaceScanResult> {
  return scanWorkspace(cwd);
}

/** Read `packageManager` from package.json (e.g. `pnpm@9.1.0` → name `pnpm`). */
async function readPackageManagerField(
  cwd: string,
): Promise<{ name?: PackageManager; raw?: string }> {
  const pkg = await readJsonSafe<PackageManifest>(join(cwd, "package.json"));
  const raw =
    typeof pkg?.packageManager === "string" ? pkg.packageManager : undefined;
  if (!raw) return {};
  const name = raw.split("@")[0] as PackageManager;
  return { name, raw };
}

/** The `workspaces` patterns declared in package.json, if any. */
async function workspacePatterns(cwd: string): Promise<string[] | null> {
  const pkg = await readJsonSafe<PackageManifest>(join(cwd, "package.json"));
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) return ws;
  if (
    ws &&
    typeof ws === "object" &&
    Array.isArray((ws as { packages?: string[] }).packages)
  )
    return (ws as { packages: string[] }).packages;
  return null;
}

// ---- Nx ----------------------------------------------------------------------

const nxAdapter: WorkspaceAdapter = {
  id: "nx",
  title: "Nx",
  precedence: 90,
  capabilities: [
    "project-graph",
    "task-pipeline",
    "dependency-constraints",
    "package-list",
  ],
  async detect(cwd) {
    const evidence: string[] = [];
    const hasNxJson = await pathExists(join(cwd, "nx.json"));
    if (hasNxJson) evidence.push("found nx.json");
    const pmField = await readPackageManagerField(cwd);
    const pkg = await readJsonSafe<PackageManifest>(join(cwd, "package.json"));
    const hasNxDep = Boolean(
      pkg && (pkg.devDependencies?.nx || pkg.dependencies?.nx),
    );
    if (hasNxDep) evidence.push("nx in dependencies");
    const detected = hasNxJson || hasNxDep;
    const confidence = hasNxJson ? 0.95 : hasNxDep ? 0.6 : 0;
    return result(
      "nx",
      detected,
      confidence,
      evidence,
      [
        "project-graph",
        "task-pipeline",
        "dependency-constraints",
        "package-list",
      ],
      pmField.name,
    );
  },
  explainDetection: (r) =>
    r.detected
      ? `Nx workspace (${r.evidence.join(", ")}) — provides the project graph + task pipeline`
      : "No nx.json or nx dependency found",
  scan,
};

// ---- Turborepo ---------------------------------------------------------------

const turboAdapter: WorkspaceAdapter = {
  id: "turbo",
  title: "Turborepo",
  precedence: 80,
  // Turborepo owns the task pipeline; the package list comes from the package
  // manager it runs on (pnpm/npm/yarn) — that's the combined-capability story.
  capabilities: ["task-pipeline"],
  async detect(cwd) {
    const evidence: string[] = [];
    const turboJson = await readJsonSafe(join(cwd, "turbo.json"));
    const hasTurboJson =
      turboJson !== null || (await pathExists(join(cwd, "turbo.json")));
    if (hasTurboJson) {
      const cfg = parseTurboConfig(turboJson);
      evidence.push(
        cfg.tasks.length
          ? `turbo.json (${cfg.tasks.length} task(s): ${cfg.tasks.slice(0, 4).join(", ")})`
          : "found turbo.json",
      );
    }
    const pkg = await readJsonSafe<PackageManifest>(join(cwd, "package.json"));
    const hasTurboDep = Boolean(
      pkg && (pkg.devDependencies?.turbo || pkg.dependencies?.turbo),
    );
    if (hasTurboDep && !hasTurboJson) evidence.push("turbo in dependencies");
    const detected = hasTurboJson || hasTurboDep;
    const confidence = hasTurboJson ? 0.95 : hasTurboDep ? 0.5 : 0;
    const pmField = await readPackageManagerField(cwd);
    return result(
      "turbo",
      detected,
      confidence,
      evidence,
      ["task-pipeline"],
      pmField.name,
    );
  },
  explainDetection: (r) =>
    r.detected
      ? `Turborepo (${r.evidence.join(", ")}) — provides the task pipeline; pairs with a package manager for the package list`
      : "No turbo.json or turbo dependency found",
  scan,
};

// ---- pnpm --------------------------------------------------------------------

const pnpmAdapter: WorkspaceAdapter = {
  id: "pnpm",
  title: "pnpm workspace",
  precedence: 70,
  capabilities: ["package-list", "package-manager"],
  async detect(cwd) {
    const evidence: string[] = [];
    const hasWsYaml = await pathExists(join(cwd, "pnpm-workspace.yaml"));
    const hasLock = await pathExists(join(cwd, "pnpm-lock.yaml"));
    const pmField = await readPackageManagerField(cwd);
    if (hasWsYaml) evidence.push("found pnpm-workspace.yaml");
    if (hasLock) evidence.push("found pnpm-lock.yaml");
    if (pmField.name === "pnpm")
      evidence.push(`packageManager: ${pmField.raw}`);
    const detected = hasWsYaml || hasLock || pmField.name === "pnpm";
    const confidence = hasWsYaml
      ? 0.95
      : hasLock || pmField.name === "pnpm"
        ? 0.8
        : 0;
    return result(
      "pnpm",
      detected,
      confidence,
      evidence,
      hasWsYaml ? ["package-list", "package-manager"] : ["package-manager"],
      detected ? "pnpm" : undefined,
    );
  },
  explainDetection: (r) =>
    r.detected
      ? `pnpm (${r.evidence.join(", ")}) — provides the workspace package list`
      : "No pnpm lockfile or workspace file found",
  scan,
};

// ---- yarn --------------------------------------------------------------------

const yarnAdapter: WorkspaceAdapter = {
  id: "yarn",
  title: "Yarn workspaces",
  precedence: 60,
  capabilities: ["package-list", "package-manager"],
  async detect(cwd) {
    const evidence: string[] = [];
    const hasLock = await pathExists(join(cwd, "yarn.lock"));
    const pmField = await readPackageManagerField(cwd);
    const patterns = await workspacePatterns(cwd);
    if (hasLock) evidence.push("found yarn.lock");
    if (pmField.name === "yarn")
      evidence.push(`packageManager: ${pmField.raw}`);
    if (hasLock && patterns)
      evidence.push(`workspaces: ${patterns.join(", ")}`);
    const detected =
      (hasLock || pmField.name === "yarn") && (Boolean(patterns) || hasLock);
    const confidence =
      hasLock && patterns
        ? 0.9
        : hasLock
          ? 0.75
          : pmField.name === "yarn"
            ? 0.6
            : 0;
    return result(
      "yarn",
      detected,
      confidence,
      evidence,
      patterns ? ["package-list", "package-manager"] : ["package-manager"],
      detected ? "yarn" : undefined,
    );
  },
  explainDetection: (r) =>
    r.detected
      ? `Yarn (${r.evidence.join(", ")})`
      : "No yarn.lock or yarn package manager found",
  scan,
};

// ---- bun ---------------------------------------------------------------------

const bunAdapter: WorkspaceAdapter = {
  id: "bun",
  title: "Bun workspaces",
  precedence: 55,
  capabilities: ["package-list", "package-manager"],
  async detect(cwd) {
    const evidence: string[] = [];
    const hasBinLock = await pathExists(join(cwd, "bun.lockb"));
    const hasTextLock = await pathExists(join(cwd, "bun.lock"));
    const pmField = await readPackageManagerField(cwd);
    const patterns = await workspacePatterns(cwd);
    if (hasBinLock) evidence.push("found bun.lockb");
    if (hasTextLock) evidence.push("found bun.lock");
    if (pmField.name === "bun") evidence.push(`packageManager: ${pmField.raw}`);
    const hasLock = hasBinLock || hasTextLock;
    const detected = hasLock || pmField.name === "bun";
    const confidence =
      hasLock && patterns
        ? 0.9
        : hasLock
          ? 0.8
          : pmField.name === "bun"
            ? 0.6
            : 0;
    return result(
      "bun",
      detected,
      confidence,
      evidence,
      patterns ? ["package-list", "package-manager"] : ["package-manager"],
      detected ? "bun" : undefined,
    );
  },
  explainDetection: (r) =>
    r.detected
      ? `Bun (${r.evidence.join(", ")})`
      : "No bun lockfile or bun package manager found",
  scan,
};

// ---- npm ---------------------------------------------------------------------

const npmAdapter: WorkspaceAdapter = {
  id: "npm",
  title: "npm workspaces",
  precedence: 50,
  capabilities: ["package-list", "package-manager"],
  async detect(cwd) {
    const evidence: string[] = [];
    const hasLock = await pathExists(join(cwd, "package-lock.json"));
    const pmField = await readPackageManagerField(cwd);
    const patterns = await workspacePatterns(cwd);
    if (hasLock) evidence.push("found package-lock.json");
    if (pmField.name === "npm") evidence.push(`packageManager: ${pmField.raw}`);
    if (patterns) evidence.push(`workspaces: ${patterns.join(", ")}`);
    // npm is the implicit fallback when a workspaces field exists but no other PM lock does.
    const detected = hasLock || pmField.name === "npm" || Boolean(patterns);
    const confidence =
      hasLock && patterns
        ? 0.9
        : hasLock
          ? 0.7
          : patterns
            ? 0.55
            : pmField.name === "npm"
              ? 0.6
              : 0;
    return result(
      "npm",
      detected,
      confidence,
      evidence,
      patterns ? ["package-list", "package-manager"] : ["package-manager"],
      detected ? "npm" : undefined,
    );
  },
  explainDetection: (r) =>
    r.detected
      ? `npm (${r.evidence.join(", ")})`
      : "No package-lock.json or npm workspaces field found",
  scan,
};

// ---- single package ----------------------------------------------------------

const singlePackageAdapter: WorkspaceAdapter = {
  id: "single-package",
  title: "Single package",
  precedence: 10,
  capabilities: ["package-list"],
  async detect(cwd) {
    const pkg = await readJsonSafe<PackageManifest>(join(cwd, "package.json"));
    if (!pkg)
      return result(
        "single-package",
        false,
        0,
        ["no package.json at root"],
        ["package-list"],
      );
    const hasWorkspaceConfig =
      Boolean(await workspacePatterns(cwd)) ||
      (await pathExists(join(cwd, "pnpm-workspace.yaml"))) ||
      (await pathExists(join(cwd, "nx.json"))) ||
      (await pathExists(join(cwd, "turbo.json")));
    // It's a single package only when nothing makes it a monorepo.
    const detected = !hasWorkspaceConfig;
    const evidence = detected
      ? [
          `root package.json (${pkg.name ?? "unnamed"}) with no workspace config`,
        ]
      : ["workspace config present — not a single package"];
    return result("single-package", detected, detected ? 0.9 : 0, evidence, [
      "package-list",
    ]);
  },
  explainDetection: (r) =>
    r.detected
      ? `Single-package repo — the root package.json is treated as one package`
      : "A workspace was detected; not single-package mode",
  scan,
};

/** All adapters, registration order. The registry sorts by precedence. */
export const workspaceAdapters: WorkspaceAdapter[] = [
  nxAdapter,
  turboAdapter,
  pnpmAdapter,
  yarnAdapter,
  bunAdapter,
  npmAdapter,
  singlePackageAdapter,
];

export {
  nxAdapter,
  turboAdapter,
  pnpmAdapter,
  yarnAdapter,
  bunAdapter,
  npmAdapter,
  singlePackageAdapter,
  // re-exported for tests + the detect command
  listDirNames,
  readText,
};
