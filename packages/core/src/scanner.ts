import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  assemblePackageInfo,
  type PackageInfo,
  type PackageManager,
  type PackageManifest,
  type WorkspaceInfo,
  type WorkspaceTooling,
} from '@package-workbench/plugin-sdk';

/**
 * The real workspace scanner. Self-contained (uses node:fs directly) so it can
 * be unit-tested against fixture directories without an injected context.
 *
 * Hard rule: a single malformed package must never crash the whole scan. Every
 * package read is wrapped; failures become per-package warnings + manifestValid
 * = false, and the package is still listed so the UI/checks can report on it.
 */

export interface ScanResult {
  workspace: WorkspaceInfo;
  packages: PackageInfo[];
}

const FALLBACK_GLOBS = ['apps/*', 'packages/*', 'libs/*'];

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listDirs(p: string): Promise<string[]> {
  try {
    const entries = await readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Read + parse a package.json, capturing malformed JSON as a warning. */
async function readManifest(
  packageJsonPath: string,
): Promise<{ manifest: PackageManifest; valid: boolean; warning?: string }> {
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, 'utf8');
  } catch (err) {
    return { manifest: {}, valid: false, warning: `Could not read package.json: ${errMsg(err)}` };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { manifest: {}, valid: false, warning: 'package.json is not a JSON object' };
    }
    return { manifest: parsed as PackageManifest, valid: true };
  } catch (err) {
    return { manifest: {}, valid: false, warning: `Invalid JSON in package.json: ${errMsg(err)}` };
  }
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function detectPackageManager(cwd: string): Promise<PackageManager> {
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(cwd, 'pnpm-workspace.yaml'))) return 'pnpm';
  if (await exists(join(cwd, 'bun.lockb'))) return 'bun';
  if (await exists(join(cwd, 'yarn.lock'))) return 'yarn';
  if (await exists(join(cwd, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

/** Extract items under the top-level `packages:` key of pnpm-workspace.yaml. */
function parsePnpmPackages(yaml: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (/^\S/.test(line) && !line.trimStart().startsWith('-')) break;
      const m = line.match(/^\s*-\s*['"]?([^'"#]+)['"]?\s*$/);
      if (m?.[1]) patterns.push(m[1].trim());
    }
  }
  return patterns;
}

/** Expand a single trailing `/*` glob (the common case) to package roots. */
async function expandGlobs(cwd: string, patterns: string[]): Promise<string[]> {
  const roots = new Set<string>();
  for (const raw of patterns) {
    const pattern = raw.replace(/^\.\//, '').replace(/\/+$/, '');
    if (pattern.endsWith('/*')) {
      const baseAbs = join(cwd, pattern.slice(0, -2));
      for (const child of await listDirs(baseAbs)) {
        const candidate = join(baseAbs, child);
        if (await exists(join(candidate, 'package.json'))) roots.add(candidate);
      }
    } else {
      const candidate = join(cwd, pattern);
      if (await exists(join(candidate, 'package.json'))) roots.add(candidate);
    }
  }
  return [...roots];
}

/** For an Nx workspace, find dirs containing a project.json under the layout roots. */
async function findNxProjects(cwd: string): Promise<string[]> {
  const roots = new Set<string>();
  for (const layout of FALLBACK_GLOBS) {
    const baseAbs = join(cwd, layout.slice(0, -2));
    for (const child of await listDirs(baseAbs)) {
      const candidate = join(baseAbs, child);
      if ((await exists(join(candidate, 'project.json'))) || (await exists(join(candidate, 'package.json')))) {
        roots.add(candidate);
      }
    }
  }
  return [...roots];
}

export async function scanWorkspace(cwdInput: string): Promise<ScanResult> {
  const cwd = resolve(cwdInput);
  const warnings: string[] = [];

  const tooling: WorkspaceTooling = {
    packageJson: await exists(join(cwd, 'package.json')),
    pnpmWorkspace: await exists(join(cwd, 'pnpm-workspace.yaml')),
    nx: await exists(join(cwd, 'nx.json')),
    turbo: await exists(join(cwd, 'turbo.json')),
    tsconfigBase: (await exists(join(cwd, 'tsconfig.base.json'))) || (await exists(join(cwd, 'tsconfig.json'))),
  };

  // ---- Discover candidate package roots, most specific source first. --------
  const rootSet = new Set<string>();

  if (tooling.pnpmWorkspace) {
    try {
      const yaml = await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8');
      for (const r of await expandGlobs(cwd, parsePnpmPackages(yaml))) rootSet.add(r);
    } catch (err) {
      warnings.push(`Failed to read pnpm-workspace.yaml: ${errMsg(err)}`);
    }
  }

  let rootManifest: PackageManifest | null = null;
  if (tooling.packageJson) {
    const { manifest, valid } = await readManifest(join(cwd, 'package.json'));
    rootManifest = valid ? manifest : null;
    const ws = manifest.workspaces;
    const wsPatterns = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : null;
    if (wsPatterns) {
      for (const r of await expandGlobs(cwd, wsPatterns)) rootSet.add(r);
    }
  }

  if (tooling.nx) {
    for (const r of await findNxProjects(cwd)) rootSet.add(r);
  }

  // Fallback: no workspace config found apps/* + packages/* convention.
  if (rootSet.size === 0) {
    for (const r of await expandGlobs(cwd, FALLBACK_GLOBS)) rootSet.add(r);
  }

  // Single-package repo: the root itself is the package.
  const isWorkspaceRoot = tooling.pnpmWorkspace || tooling.nx || Boolean(rootManifest?.workspaces);
  if (rootSet.size === 0 && tooling.packageJson && !isWorkspaceRoot) {
    rootSet.add(cwd);
  }

  // ---- Build PackageInfo for each root (never throw). -----------------------
  const packages: PackageInfo[] = [];
  for (const root of [...rootSet].sort()) {
    const packageJsonPath = join(root, 'package.json');
    if (!(await exists(packageJsonPath))) continue; // nx project.json without package.json
    const { manifest, valid, warning } = await readManifest(packageJsonPath);
    const pkgWarnings = warning ? [warning] : [];
    packages.push(
      assemblePackageInfo({
        root,
        packageJsonPath,
        manifest,
        manifestValid: valid,
        warnings: pkgWarnings,
        fallbackName: basename(root),
      }),
    );
  }

  if (packages.length === 0) warnings.push('No packages discovered in this workspace.');

  const workspace: WorkspaceInfo = {
    root: cwd,
    name: rootManifest?.name ?? basename(cwd),
    packageManager: await detectPackageManager(cwd),
    isMonorepo: packages.length > 1 || isWorkspaceRoot,
    packageCount: packages.length,
    tooling,
    warnings,
  };

  return { workspace, packages };
}
