import type { HealthCheck } from "@package-workbench/plugin-sdk";
import { packageJsonValid } from "./package-json-valid";
import { packageNamePresent } from "./package-name-present";
import { entrypointExists } from "./entrypoint-exists";
import { mainModuleExists } from "./main-module-exists";
import { typesEntryExists } from "./types-entry-exists";
import { missingPeerDependencies } from "./missing-peer-dependencies";
import { requiredScriptsPresent } from "./required-scripts-present";
import { dependencyVersionShape } from "./dependency-version-shape";
import { moduleResolutionCheck } from "./module-resolution-check";
import { exportsMapCheck } from "./exports-map-check";
import { browserCompatibilityCheck } from "./browser-compatibility-check";
import { runtimeImportCheck } from "./runtime-import-check";
import { scenarioRunnerCheck } from "./scenario-runner-check";

export {
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
};

/**
 * Default check set, ordered cheap → expensive. The static checks (manifest,
 * resolution, exports, browser) never execute code. The runtime + scenario
 * checks do: `runtime_import_check` imports the entry in a child process, and
 * `scenario_runner_check` runs plugin scenarios when `PW_RUN_SCENARIOS` is set.
 */
export const builtinChecks: HealthCheck[] = [
  packageJsonValid,
  packageNamePresent,
  entrypointExists,
  mainModuleExists,
  typesEntryExists,
  moduleResolutionCheck,
  exportsMapCheck,
  missingPeerDependencies,
  requiredScriptsPresent,
  dependencyVersionShape,
  browserCompatibilityCheck,
  runtimeImportCheck,
  scenarioRunnerCheck,
];
