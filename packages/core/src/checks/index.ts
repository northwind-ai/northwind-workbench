import type { HealthCheck } from '@package-workbench/plugin-sdk';
import { packageJsonValid } from './package-json-valid';
import { packageNamePresent } from './package-name-present';
import { entrypointExists } from './entrypoint-exists';
import { mainModuleExists } from './main-module-exists';
import { typesEntryExists } from './types-entry-exists';
import { missingPeerDependencies } from './missing-peer-dependencies';
import { requiredScriptsPresent } from './required-scripts-present';
import { dependencyVersionShape } from './dependency-version-shape';
import { importCheck } from './import-check';

export {
  packageJsonValid,
  packageNamePresent,
  entrypointExists,
  mainModuleExists,
  typesEntryExists,
  missingPeerDependencies,
  requiredScriptsPresent,
  dependencyVersionShape,
  importCheck,
};

/**
 * Default check set. All static and deterministic — no builds, no code
 * execution. `import_check` is a declared-but-skipped placeholder for the
 * upcoming runtime import feature.
 */
export const builtinChecks: HealthCheck[] = [
  packageJsonValid,
  packageNamePresent,
  entrypointExists,
  mainModuleExists,
  typesEntryExists,
  missingPeerDependencies,
  requiredScriptsPresent,
  dependencyVersionShape,
  importCheck,
];
