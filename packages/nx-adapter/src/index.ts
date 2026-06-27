import { join } from "node:path";
import {
  assemblePackageInfo,
  defineAdapter,
  defineValidator,
  defineWorkbenchPlugin,
  pass,
  skip,
  warn,
  type PackageInfo,
  type PackageManifest,
  type PluginContext,
} from "@package-workbench/plugin-sdk";

/**
 * Starter plugin #2: the Nx workspace plugin. It both *discovers* Nx projects (a
 * WorkspaceAdapter) and *validates* them (a classifier that reads project.json
 * and confirms apps live under apps/ and libs under libs/). Depends only on the
 * plugin SDK — never on core internals — so it doubles as the reference for any
 * private adapter/validator.
 */

const LAYOUT_ROOTS = ["packages", "apps", "libs"];

interface NxProjectJson {
  name?: string;
  projectType?: "application" | "library";
  sourceRoot?: string;
  tags?: string[];
  targets?: Record<string, unknown>;
}

async function readProject(
  dir: string,
  ctx: PluginContext,
): Promise<PackageInfo | null> {
  const packageJsonPath = join(dir, "package.json");
  const manifest = await ctx.readJson<PackageManifest>(packageJsonPath);
  const project = await ctx.readJson<NxProjectJson>(join(dir, "project.json"));
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
  id: "nx",
  title: "Nx workspace",

  async detect(cwd, ctx) {
    return ctx.fileExists(join(cwd, "nx.json"));
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

/** Which layout root a package sits under, for app/lib expectations. */
function layoutOf(root: string): "apps" | "libs" | "packages" | "other" {
  const norm = root.split("\\").join("/");
  if (/\/apps\//.test(norm)) return "apps";
  if (/\/libs\//.test(norm)) return "libs";
  if (/\/packages\//.test(norm)) return "packages";
  return "other";
}

/** Validator: read project.json, classify app vs lib, and flag layout mismatches. */
const projectClassification = defineValidator({
  id: "nx:project-classification",
  label: "Nx project is well-classified",
  description:
    "project.json declares a projectType consistent with its apps//libs/ location.",
  severity: "low",
  weight: 1,
  async run({ package: pkg, host }) {
    const projectPath = join(pkg.root, "project.json");
    if (!(await host.fileExists(projectPath)))
      return skip("Not an Nx project (no project.json)");

    const project = await host.readJson<NxProjectJson>(projectPath);
    if (!project)
      return warn("low", "project.json present but could not be parsed");

    const declared = project.projectType;
    const layout = layoutOf(pkg.root);
    const targets = project.targets ? Object.keys(project.targets) : [];
    const evidence = [
      `projectType: ${declared ?? "(unset)"}`,
      `layout: ${layout}`,
      targets.length ? `targets: ${targets.join(", ")}` : "targets: (none)",
    ];

    if (!declared) {
      return warn("low", 'project.json does not declare a "projectType"', {
        evidence,
      });
    }
    const expected = declared === "application" ? "apps" : "libs";
    if (layout !== "other" && layout !== "packages" && layout !== expected) {
      return warn(
        "low",
        `${declared} lives under ${layout}/ (Nx convention expects ${expected}/)`,
        { evidence },
      );
    }
    return pass(`Classified as ${declared}`, { evidence });
  },
});

export const nxPlugin = defineWorkbenchPlugin({
  id: "@package-workbench/nx-adapter",
  name: "Nx workspace plugin",
  version: "0.1.0",
  // Discovery is workspace-level; the classifier self-skips non-Nx packages, so
  // this plugin can safely apply everywhere.
  supports: () => true,
  adapters: [nxAdapter],
  validators: [projectClassification],
});

export default nxPlugin;
