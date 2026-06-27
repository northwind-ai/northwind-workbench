/**
 * @package-workbench/core — the headless engine.
 *
 * Public surface consumed by the CLI and the Electron main process. Contains NO
 * UI and NO Electron code. The renderer must only import TYPES from here.
 */

// Re-export the SDK so consumers have a single import for the whole domain.
export * from "@package-workbench/plugin-sdk";

export * from "./types";
export { CheckId } from "./check-ids";
export * from "./runner";
export { PluginHost } from "./registry";
export { createNodeContext, createConsoleLogger } from "./context";
export {
  computeScore,
  computeConfidence,
  computeStatus,
  buildReport,
  summarize,
} from "./scoring";
export { scanWorkspace, type ScanResult } from "./scanner";
export * from "./runtime";
export * from "./scenarios";
export * from "./graph";
export * from "./history";
export * from "./engine";
export * from "./ai";
export * from "./pr";
export * from "./intel";
export * from "./refactor";
export * from "./fix";
// Workspace adapters. Exported selectively because the adapter *interface* shares
// the name `WorkspaceAdapter` with the SDK's plugin-facing adapter — the new
// detection adapter is surfaced here as `WorkspaceFlavorAdapter`.
export {
  detectAll,
  detectWorkspaceStack,
  scanWithAdapters,
  explainStack,
  workspaceAdapters,
  parseTurboConfig,
  classifyTurboPackage,
  classifyPackages,
} from "./adapters";
export type {
  AdapterId,
  WorkspaceCapability,
  WorkspaceDetectionResult,
  WorkspaceScanResult,
  WorkspaceStack,
  TurboPackageClass,
  TurboConfig,
  WorkspaceAdapter as WorkspaceFlavorAdapter,
} from "./adapters";
export {
  builtinChecks,
  packageJsonValid,
  packageNamePresent,
  entrypointExists,
  mainModuleExists,
  typesEntryExists,
  missingPeerDependencies,
  requiredScriptsPresent,
  dependencyVersionShape,
  moduleResolutionCheck,
  exportsMapCheck,
  browserCompatibilityCheck,
  runtimeImportCheck,
  scenarioRunnerCheck,
} from "./checks";
export {
  builtinPlugins,
  typescriptPlugin,
  loadWorkspacePlugins,
  type LoadedPlugins,
  type PluginLoadError,
} from "./plugins";
export { createMockRun } from "./mock-runner";
