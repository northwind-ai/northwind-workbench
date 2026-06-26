import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assemblePackageInfo,
  type CheckContext,
  type ExecResult,
  type PackageManifest,
  type PluginContext,
  type WorkspaceInfo,
} from '@package-workbench/plugin-sdk';
import {
  dependencyVersionShape,
  entrypointExists,
  importCheck,
  mainModuleExists,
  missingPeerDependencies,
  packageJsonValid,
  packageNamePresent,
  requiredScriptsPresent,
  typesEntryExists,
} from './index';

const ROOT = '/pkg';

const workspace: WorkspaceInfo = {
  root: '/ws',
  name: 'ws',
  packageManager: 'pnpm',
  isMonorepo: false,
  packageCount: 1,
  tooling: { packageJson: true, pnpmWorkspace: false, nx: false, turbo: false, tsconfigBase: false },
  warnings: [],
};

interface Opts {
  files?: string[];
  manifestValid?: boolean;
  warnings?: string[];
  root?: string;
}

function makeCtx(manifest: PackageManifest, opts: Opts = {}): CheckContext {
  const root = opts.root ?? ROOT;
  const files = new Set(opts.files ?? []);
  const host: PluginContext = {
    cwd: workspace.root,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    exec: async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
    readJson: async () => null,
    fileExists: async (p) => files.has(p),
    readDir: async () => [],
  };
  const pkg = assemblePackageInfo({
    root,
    packageJsonPath: join(root, 'package.json'),
    manifest: { name: 'x', version: '1.0.0', ...manifest },
    manifestValid: opts.manifestValid ?? true,
    warnings: opts.warnings,
  });
  return { package: pkg, workspace, host };
}

describe('package_json_valid', () => {
  it('passes for a valid manifest', async () => {
    expect((await packageJsonValid.run(makeCtx({}))).status).toBe('pass');
  });
  it('fails when the manifest is invalid', async () => {
    const out = await packageJsonValid.run(makeCtx({}, { manifestValid: false, warnings: ['Invalid JSON'] }));
    expect(out.status).toBe('fail');
    expect(out.severity).toBe('critical');
  });
});

describe('package_name_present', () => {
  it('passes when a name is set', async () => {
    expect((await packageNamePresent.run(makeCtx({ name: 'pkg' }))).status).toBe('pass');
  });
  it('fails when name is blank', async () => {
    expect((await packageNamePresent.run(makeCtx({ name: '' }))).status).toBe('fail');
  });
});

describe('entrypoint_exists', () => {
  it('passes when a declared entry resolves', async () => {
    const out = await entrypointExists.run(makeCtx({ main: 'index.js' }, { files: [join(ROOT, 'index.js')] }));
    expect(out.status).toBe('pass');
  });
  it('fails when declared entries are all missing', async () => {
    expect((await entrypointExists.run(makeCtx({ main: 'dist/index.js' }))).status).toBe('fail');
  });
  it('passes via an index fallback when nothing is declared', async () => {
    const out = await entrypointExists.run(makeCtx({}, { files: [join(ROOT, 'index.js')] }));
    expect(out.status).toBe('pass');
  });
  it('warns when nothing is declared and no index exists', async () => {
    expect((await entrypointExists.run(makeCtx({}))).status).toBe('warn');
  });
});

describe('main_module_exists', () => {
  it('skips when no main/module', async () => {
    expect((await mainModuleExists.run(makeCtx({}))).status).toBe('skip');
  });
  it('fails when main is declared but missing', async () => {
    expect((await mainModuleExists.run(makeCtx({ main: 'dist/index.js' }))).status).toBe('fail');
  });
});

describe('types_entry_exists', () => {
  it('skips with no types field', async () => {
    expect((await typesEntryExists.run(makeCtx({}))).status).toBe('skip');
  });
  it('fails when the declared types file is missing', async () => {
    expect((await typesEntryExists.run(makeCtx({ types: 'dist/index.d.ts' }))).status).toBe('fail');
  });
});

describe('missing_peer_dependencies', () => {
  it('skips with no peers', async () => {
    expect((await missingPeerDependencies.run(makeCtx({}))).status).toBe('skip');
  });
  it('warns when a required peer is not resolvable', async () => {
    const out = await missingPeerDependencies.run(makeCtx({ peerDependencies: { react: '^18' } }));
    expect(out.status).toBe('warn');
  });
  it('passes when the peer is present in the workspace root', async () => {
    const out = await missingPeerDependencies.run(
      makeCtx({ peerDependencies: { react: '^18' } }, { files: [join(workspace.root, 'node_modules', 'react', 'package.json')] }),
    );
    expect(out.status).toBe('pass');
  });
});

describe('required_scripts_present', () => {
  it('warns when a library lacks build/test', async () => {
    const out = await requiredScriptsPresent.run(makeCtx({ main: 'index.js' }));
    expect(out.status).toBe('warn');
  });
  it('passes when common scripts exist', async () => {
    const out = await requiredScriptsPresent.run(
      makeCtx({ main: 'index.js', scripts: { build: 'x', test: 'y', typecheck: 'z', lint: 'w' } }),
    );
    expect(out.status).toBe('pass');
  });
});

describe('dependency_version_shape', () => {
  it('skips with no dependencies', async () => {
    expect((await dependencyVersionShape.run(makeCtx({}))).status).toBe('skip');
  });
  it('passes for well-formed specifiers', async () => {
    const out = await dependencyVersionShape.run(
      makeCtx({ dependencies: { a: '^1.2.3', b: 'workspace:*', c: '~2.0.0', d: '*', e: 'npm:foo@^1' } }),
    );
    expect(out.status).toBe('pass');
  });
  it('warns for malformed specifiers', async () => {
    const out = await dependencyVersionShape.run(makeCtx({ dependencies: { a: '^^1.0.0', b: '' } }));
    expect(out.status).toBe('warn');
    expect(out.evidence?.length).toBe(2);
  });
});

describe('import_check', () => {
  it('is a skipped placeholder with a clear reason', async () => {
    const out = await importCheck.run(makeCtx({}));
    expect(out.status).toBe('skip');
    expect(out.summary).toMatch(/later prompt/i);
  });
});
