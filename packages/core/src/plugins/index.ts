/**
 * Plugin subsystem: config-driven discovery + the built-in starter plugins that
 * ship with core. External plugins are loaded via {@link loadWorkspacePlugins}.
 */
import type { Plugin } from "@package-workbench/plugin-sdk";
import { typescriptPlugin } from "./typescript-plugin";

export { typescriptPlugin } from "./typescript-plugin";
export {
  loadWorkspacePlugins,
  type LoadedPlugins,
  type PluginLoadError,
} from "./load";

/** Starter plugins registered by default (in addition to the core checks). */
export const builtinPlugins: Plugin[] = [typescriptPlugin];
