/**
 * @package-workbench/core — the headless engine.
 *
 * Public surface consumed by the CLI and the Electron main process. Contains NO
 * UI and NO Electron code. The renderer must only import TYPES from here.
 */

// Re-export the SDK so consumers have a single import for the whole domain.
export * from '@package-workbench/plugin-sdk';

export * from './types';
export { CheckId } from './check-ids';
export * from './runner';
export { PluginHost } from './registry';
export { createNodeContext, createConsoleLogger } from './context';
export { computeScore, computeConfidence, computeStatus, buildReport, summarize } from './scoring';
export { scanWorkspace, type ScanResult } from './scanner';
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
  importCheck,
} from './checks';
export { createMockRun } from './mock-runner';
