import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@package-workbench/plugin-sdk";

/**
 * Config-driven plugin discovery. Looks for a Workbench config at the workspace
 * root (or a `packageWorkbench.plugins` field in package.json), resolves each
 * referenced plugin, and loads it.
 *
 * Hard rule: a broken plugin must never crash Workbench. Every resolution and
 * import is wrapped — failures become structured {@link PluginLoadError}s and the
 * remaining plugins still load.
 */

export interface PluginLoadError {
  /** The config entry that failed (package name or path). */
  source: string;
  message: string;
}

export interface LoadedPlugins {
  plugins: Plugin[];
  errors: PluginLoadError[];
  /** The config file that was used, if any. */
  configFile?: string;
}

/** Config-file names probed in order, most specific first. */
const CONFIG_CANDIDATES = [
  "workbench.config.ts",
  "workbench.config.mts",
  "workbench.config.js",
  "workbench.config.mjs",
  "workbench.config.cjs",
  "package-workbench.plugins.ts",
  "package-workbench.plugins.mts",
  "package-workbench.plugins.js",
  "package-workbench.plugins.mjs",
];

type PluginRef = string | Plugin;
interface WorkbenchConfig {
  plugins?: PluginRef[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Locate the plugin list + its source, from a config file or package.json. */
async function findConfig(
  cwd: string,
): Promise<{ refs: PluginRef[]; configFile?: string }> {
  for (const name of CONFIG_CANDIDATES) {
    const abs = join(cwd, name);
    if (await exists(abs)) {
      const mod = await importModule(abs);
      const cfg = (mod.default ?? mod) as WorkbenchConfig | PluginRef[];
      const refs = Array.isArray(cfg) ? cfg : (cfg.plugins ?? []);
      return { refs, configFile: abs };
    }
  }

  // Fallback: a `packageWorkbench.plugins` array in package.json.
  const pkgPath = join(cwd, "package.json");
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        packageWorkbench?: WorkbenchConfig;
      };
      const refs = pkg.packageWorkbench?.plugins ?? [];
      if (refs.length > 0) return { refs, configFile: pkgPath };
    } catch {
      // ignore malformed package.json here — the scanner reports it separately
    }
  }

  return { refs: [] };
}

/** Dynamically import a module by absolute path (ESM/CJS/TS via the host loader). */
async function importModule(absPath: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(absPath).href)) as Record<string, unknown>;
}

/** Resolve a plugin reference string to an absolute module path. */
function resolveRef(cwd: string, ref: string): string {
  if (ref.startsWith(".") || isAbsolute(ref)) return resolve(cwd, ref);
  // Bare specifier — resolve from the workspace's node_modules.
  const req = createRequire(join(cwd, "__workbench_plugin_resolver__.js"));
  return req.resolve(ref);
}

/** Coerce an imported module into a Plugin, or throw with a clear reason. */
function coercePlugin(source: string, mod: Record<string, unknown>): Plugin {
  const candidate = (mod.default ?? mod.plugin ?? mod) as Partial<Plugin>;
  if (!candidate || typeof candidate !== "object")
    throw new Error("module did not export a plugin object");
  if (typeof candidate.name !== "string" && typeof candidate.id !== "string") {
    throw new Error('exported plugin has neither a "name" nor an "id"');
  }
  return { ...candidate, name: candidate.name ?? candidate.id! } as Plugin;
}

/**
 * Discover and load all plugins configured for a workspace. Never throws.
 * Optionally pass `extra` plugin objects already in memory (they bypass loading).
 */
export async function loadWorkspacePlugins(
  cwd: string,
  extra: Plugin[] = [],
): Promise<LoadedPlugins> {
  const root = resolve(cwd);
  const plugins: Plugin[] = [...extra];
  const errors: PluginLoadError[] = [];

  let refs: PluginRef[] = [];
  let configFile: string | undefined;
  try {
    const found = await findConfig(root);
    refs = found.refs;
    configFile = found.configFile;
  } catch (err) {
    errors.push({
      source: "config",
      message: `Failed to read Workbench config: ${msg(err)}`,
    });
    return { plugins, errors };
  }

  for (const ref of refs) {
    if (ref && typeof ref === "object") {
      // Inline plugin object straight from a TS/JS config.
      try {
        plugins.push(
          coercePlugin("inline", ref as unknown as Record<string, unknown>),
        );
      } catch (err) {
        errors.push({ source: "inline", message: msg(err) });
      }
      continue;
    }
    const name = String(ref);
    try {
      const abs = resolveRef(root, name);
      const mod = await importModule(abs);
      plugins.push(coercePlugin(name, mod));
    } catch (err) {
      errors.push({ source: name, message: msg(err) });
    }
  }

  return { plugins, errors, configFile };
}

const msg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
