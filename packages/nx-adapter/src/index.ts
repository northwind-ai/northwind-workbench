import { join } from 'node:path';
import {
  assemblePackageInfo,
  defineAdapter,
  definePlugin,
  type PackageInfo,
  type PackageManifest,
  type PluginContext,
} from '@package-workbench/plugin-sdk';

/**
 * Reference plugin: enumerate packages in an Nx workspace. This is the shape any
 * repo would follow to add a custom adapter — it depends only on the plugin SDK
 * and never touches core internals.
 *
 * Note: core's built-in scanner already understands Nx layouts; this plugin
 * exists as a worked example of the WorkspaceAdapter contract. Nx discovery here
 * is pragmatic (scan conventional roots for project.json/package.json); a
 * production version would shell out to `nx show projects --json`.
 */

const LAYOUT_ROOTS = ['packages', 'apps', 'libs'];

async function readProject(dir: string, ctx: PluginContext): Promise<PackageInfo | null> {
  const packageJsonPath = join(dir, 'package.json');
  const manifest = await ctx.readJson<PackageManifest>(packageJsonPath);
  const project = await ctx.readJson<{ name?: string }>(join(dir, 'project.json'));
  if (!manifest && !project) return null;

  return assemblePackageInfo({
    root: dir,
    packageJsonPath,
    manifest: manifest ?? { name: project?.name },
    manifestValid: manifest != null,
    fallbackName: project?.name ?? dir.split(/[/\\]/).pop() ?? dir,
  });
}

export const nxAdapter = defineAdapter({
  id: 'nx',
  title: 'Nx workspace',

  async detect(cwd, ctx) {
    return ctx.fileExists(join(cwd, 'nx.json'));
  },

  async listPackages(cwd, ctx) {
    const found: PackageInfo[] = [];
    for (const root of LAYOUT_ROOTS) {
      for (const child of await ctx.readDir(join(cwd, root))) {
        const ref = await readProject(join(cwd, root, child), ctx);
        if (ref) found.push(ref);
      }
    }
    return found;
  },
});

export const nxPlugin = definePlugin({
  name: '@package-workbench/nx-adapter',
  version: '0.0.1',
  adapters: [nxAdapter],
});

export default nxPlugin;
