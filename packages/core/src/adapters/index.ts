/**
 * Workspace adapters — production-quality detection for Nx, Turborepo, pnpm,
 * npm, yarn, and bun workspaces, plus single-package repos. Detection is
 * declarative (lock files, config files, the `workspaces` field,
 * `packageManager`), so it is fast, offline, install-free, and never crashes on
 * a malformed workspace file.
 *
 * Repos commonly match several adapters; {@link detectWorkspaceStack} resolves a
 * primary by precedence and *combines* their capabilities. Package discovery is
 * delegated to the hardened `scanWorkspace`, so adapters never duplicate
 * traversal logic.
 */
export * from "./types";
export {
  workspaceAdapters,
  nxAdapter,
  turboAdapter,
  pnpmAdapter,
  yarnAdapter,
  bunAdapter,
  npmAdapter,
  singlePackageAdapter,
} from "./adapters";
export {
  detectAll,
  detectWorkspaceStack,
  scanWithAdapters,
  explainStack,
} from "./registry";
export {
  parseTurboConfig,
  classifyTurboPackage,
  classifyPackages,
  type TurboConfig,
} from "./turbo";
