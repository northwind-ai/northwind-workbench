import {
  assemblePackageInfo,
  type HealthCheckResult,
  type PackageInfo,
  type PackageManifest,
  type WorkspaceInfo,
} from '@package-workbench/plugin-sdk';
import type { WorkbenchRun } from './types';
import { CheckId } from './check-ids';
import { buildReport, summarize } from './scoring';

/**
 * Deterministic mock run. No filesystem access, no randomness — used by the
 * desktop app on first launch and by `pw scan --mock`, shared verbatim by both
 * so the UI and CLI render identical data. Demonstrates every interesting state:
 * healthy, missing peer dep, build/entry failure, and an unknown check.
 */

const AT = '2020-01-01T00:00:00.000Z';

function pkg(name: string, manifest: Partial<PackageManifest>): PackageInfo {
  const dir = name.replace(/^@[^/]+\//, '');
  const root = `/workspace/packages/${dir}`;
  return assemblePackageInfo({
    root,
    packageJsonPath: `${root}/package.json`,
    manifest: { name, version: '1.0.0', ...manifest },
  });
}

function res(
  checkId: string,
  label: string,
  status: HealthCheckResult['status'],
  severity: HealthCheckResult['severity'],
  summary: string,
  extra: Partial<HealthCheckResult> = {},
): HealthCheckResult {
  return { checkId, label, status, severity, summary, ...extra };
}

const goodChecks = (): HealthCheckResult[] => [
  res(CheckId.packageJsonValid, 'package.json is valid', 'pass', 'critical', 'package.json parsed successfully'),
  res(CheckId.packageNamePresent, 'Package has a name', 'pass', 'high', 'Named'),
  res(CheckId.entrypointExists, 'Has a resolvable entry point', 'pass', 'high', 'Entry resolves'),
  res(CheckId.mainModuleExists, '"main"/"module" file exists', 'pass', 'high', 'Module target resolves'),
  res(CheckId.typesEntryExists, 'Type declarations exist', 'pass', 'medium', 'Types resolve'),
  res(CheckId.missingPeerDependencies, 'Peer dependencies resolvable', 'pass', 'high', 'All peers resolvable'),
  res(CheckId.requiredScriptsPresent, 'Common scripts present', 'pass', 'low', '4/4 common scripts present'),
  res(CheckId.dependencyVersionShape, 'Dependency versions well-formed', 'pass', 'low', 'Specifiers look valid'),
  res(CheckId.import, 'Module can be imported', 'skip', 'info', 'Runtime import execution will be added in a later prompt.'),
];

export function createMockRun(): WorkbenchRun {
  const workspace: WorkspaceInfo = {
    root: '/workspace',
    name: 'demo-workspace',
    packageManager: 'pnpm',
    isMonorepo: true,
    packageCount: 4,
    tooling: { packageJson: true, pnpmWorkspace: true, nx: false, turbo: false, tsconfigBase: true },
    warnings: [],
  };

  const definitions: Array<{ pkg: PackageInfo; checks: HealthCheckResult[] }> = [
    // 1. Healthy library.
    {
      pkg: pkg('@acme/core', { main: 'dist/index.js', types: 'dist/index.d.ts', scripts: { build: 'tsup', test: 'vitest' } }),
      checks: goodChecks(),
    },

    // 2. Missing peer dependency (warning) + browser UI lib.
    {
      pkg: pkg('@acme/ui', {
        main: 'dist/index.js',
        peerDependencies: { react: '^18', 'react-dom': '^18' },
        dependencies: { react: '^18.3.1' },
      }),
      checks: [
        ...goodChecks().slice(0, 5),
        res(CheckId.missingPeerDependencies, 'Peer dependencies resolvable', 'warn', 'high', '1 required peer not resolvable', {
          details: 'Install these where the package is consumed, or they will fail at runtime.',
          evidence: ['react-dom@^18'],
        }),
        res(CheckId.requiredScriptsPresent, 'Common scripts present', 'warn', 'low', 'Library is missing build and/or test script', {
          details: 'present: none · absent: build, test, typecheck, lint',
        }),
        res(CheckId.dependencyVersionShape, 'Dependency versions well-formed', 'pass', 'low', 'Specifiers look valid'),
        res(CheckId.import, 'Module can be imported', 'skip', 'info', 'Runtime import execution will be added in a later prompt.'),
      ],
    },

    // 3. Entry point failure (critical) — build never emitted the file.
    {
      pkg: pkg('@acme/client', { main: 'dist/index.js', types: 'dist/index.d.ts' }),
      checks: [
        res(CheckId.packageJsonValid, 'package.json is valid', 'pass', 'critical', 'package.json parsed successfully'),
        res(CheckId.packageNamePresent, 'Package has a name', 'pass', 'high', 'Named "@acme/client"'),
        res(CheckId.entrypointExists, 'Has a resolvable entry point', 'fail', 'high', 'No declared entry point resolves on disk', {
          details: 'Every declared entry points at a file that does not exist (build not run?).',
          evidence: ['dist/index.js'],
        }),
        res(CheckId.mainModuleExists, '"main"/"module" file exists', 'fail', 'high', '1/1 module target(s) missing', {
          evidence: ['main: dist/index.js'],
        }),
        res(CheckId.typesEntryExists, 'Type declarations exist', 'fail', 'medium', 'Declared types file missing: dist/index.d.ts'),
        res(CheckId.missingPeerDependencies, 'Peer dependencies resolvable', 'skip', 'info', 'No peer dependencies declared'),
        res(CheckId.requiredScriptsPresent, 'Common scripts present', 'warn', 'low', 'Library is missing build and/or test script'),
        res(CheckId.dependencyVersionShape, 'Dependency versions well-formed', 'skip', 'info', 'No dependencies declared'),
        res(CheckId.import, 'Module can be imported', 'skip', 'info', 'Runtime import execution will be added in a later prompt.'),
      ],
    },

    // 4. Malformed package.json + unknown signal.
    {
      pkg: assemblePackageInfo({
        root: '/workspace/packages/legacy',
        packageJsonPath: '/workspace/packages/legacy/package.json',
        manifest: {},
        manifestValid: false,
        warnings: ['Invalid JSON in package.json: Unexpected token } in JSON at position 42'],
        fallbackName: 'legacy',
      }),
      checks: [
        res(CheckId.packageJsonValid, 'package.json is valid', 'fail', 'critical', 'package.json is missing or invalid', {
          evidence: ['Invalid JSON in package.json: Unexpected token } in JSON at position 42'],
        }),
        res(CheckId.packageNamePresent, 'Package has a name', 'fail', 'high', 'Missing "name" field'),
        res(CheckId.entrypointExists, 'Has a resolvable entry point', 'unknown', 'medium', 'Could not evaluate (invalid manifest)'),
        res(CheckId.mainModuleExists, '"main"/"module" file exists', 'skip', 'info', 'No "main" or "module" field declared'),
        res(CheckId.typesEntryExists, 'Type declarations exist', 'skip', 'info', 'No "types"/"typings" field declared'),
        res(CheckId.missingPeerDependencies, 'Peer dependencies resolvable', 'skip', 'info', 'No peer dependencies declared'),
        res(CheckId.requiredScriptsPresent, 'Common scripts present', 'warn', 'low', 'No common scripts defined'),
        res(CheckId.dependencyVersionShape, 'Dependency versions well-formed', 'skip', 'info', 'No dependencies declared'),
        res(CheckId.import, 'Module can be imported', 'skip', 'info', 'Runtime import execution will be added in a later prompt.'),
      ],
    },
  ];

  const reports = definitions.map((d) => buildReport(d.pkg, d.checks, AT));

  return {
    id: 'mock-run',
    workspace,
    reports,
    summary: summarize(reports),
    startedAt: AT,
    finishedAt: AT,
  };
}
