/**
 * Canonical, generic check identifiers. Plugins may add their own namespaced ids
 * (e.g. "myorg:license-check"); these built-in ids are stable and the UI may
 * special-case them (icons, ordering).
 */
export const CheckId = {
  packageJsonValid: "package_json_valid",
  packageNamePresent: "package_name_present",
  entrypointExists: "entrypoint_exists",
  mainModuleExists: "main_module_exists",
  typesEntryExists: "types_entry_exists",
  missingPeerDependencies: "missing_peer_dependencies",
  requiredScriptsPresent: "required_scripts_present",
  dependencyVersionShape: "dependency_version_shape",
  // Runtime validation engine.
  moduleResolution: "module_resolution_check",
  exportsMap: "exports_map_check",
  browserCompatibility: "browser_compatibility_check",
  runtimeImport: "runtime_import_check",
  // Scenario engine.
  scenarioRunner: "scenario_runner_check",
  // Package-intelligence engine (opt-in; warnings, never hard failures).
  unusedExport: "unused_export_check",
  staleReexport: "stale_reexport_check",
  bundleSize: "bundle_size_check",
  dependencyWeight: "dependency_weight_check",
  duplicateVersion: "duplicate_version_check",
} as const;

export type CheckId = (typeof CheckId)[keyof typeof CheckId];
