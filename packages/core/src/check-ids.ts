/**
 * Canonical, generic check identifiers. Plugins may add their own namespaced ids
 * (e.g. "myorg:license-check"); these built-in ids are stable and the UI may
 * special-case them (icons, ordering).
 */
export const CheckId = {
  packageJsonValid: 'package_json_valid',
  packageNamePresent: 'package_name_present',
  entrypointExists: 'entrypoint_exists',
  mainModuleExists: 'main_module_exists',
  typesEntryExists: 'types_entry_exists',
  missingPeerDependencies: 'missing_peer_dependencies',
  requiredScriptsPresent: 'required_scripts_present',
  dependencyVersionShape: 'dependency_version_shape',
  import: 'import_check',
} as const;

export type CheckId = (typeof CheckId)[keyof typeof CheckId];
