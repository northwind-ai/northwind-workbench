import { EventEmitter } from 'node:events';
import type {
  HealthCheckResult,
  PackageInfo,
  Plugin,
  PluginContext,
  WorkspaceInfo,
} from '@package-workbench/plugin-sdk';
import { PluginHost } from './registry';
import { createNodeContext } from './context';
import { buildReport, summarize } from './scoring';
import { scanWorkspace } from './scanner';
import { builtinChecks } from './checks';
import type { PackageHealthReport, RunnerEvent, WorkbenchRun } from './types';

export interface RunnerOptions {
  cwd: string;
  /** Extra plugins (adapters/checks). Loaded after built-ins. */
  plugins?: Plugin[];
  /** Set false to drop the built-in checks. */
  includeBuiltins?: boolean;
  /** Inject a custom context (e.g. for tests). Defaults to the Node context. */
  context?: PluginContext;
  /** Supplies run id + timestamps (kept injectable so runs stay testable). */
  clock?: () => string;
}

export interface Runner {
  readonly host: PluginHost;
  on(listener: (event: RunnerEvent) => void): () => void;
  inspect(): Promise<{ workspace: WorkspaceInfo; packages: PackageInfo[] }>;
  checkPackage(pkg: PackageInfo, workspace: WorkspaceInfo): Promise<PackageHealthReport>;
  run(): Promise<WorkbenchRun>;
}

/**
 * The real engine shared by the CLI and the desktop app. Discovery is done by
 * the core scanner; plugin adapters can contribute additional packages, and
 * plugin checks run alongside the built-ins.
 */
export function createRunner(opts: RunnerOptions): Runner {
  const ctx = opts.context ?? createNodeContext(opts.cwd);
  const now = opts.clock ?? (() => new Date().toISOString());
  const emitter = new EventEmitter();
  const emit = (e: RunnerEvent) => emitter.emit('event', e);

  const corePlugin: Plugin = { name: '@package-workbench/core', checks: builtinChecks };
  const host = new PluginHost([
    ...(opts.includeBuiltins === false ? [] : [corePlugin]),
    ...(opts.plugins ?? []),
  ]);

  async function inspect(): Promise<{ workspace: WorkspaceInfo; packages: PackageInfo[] }> {
    const { workspace, packages } = await scanWorkspace(opts.cwd);

    // Let plugin adapters contribute extra packages (deduped by root).
    const byRoot = new Map(packages.map((p) => [p.root, p]));
    for (const adapter of host.adapters) {
      try {
        if (await adapter.detect(opts.cwd, ctx)) {
          for (const p of await adapter.listPackages(opts.cwd, ctx)) {
            if (!byRoot.has(p.root)) byRoot.set(p.root, p);
          }
        }
      } catch (err) {
        workspace.warnings.push(`Adapter "${adapter.id}" failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const merged = [...byRoot.values()];
    const finalWorkspace = { ...workspace, packageCount: merged.length };
    emit({ type: 'workspace:detected', workspace: finalWorkspace });
    return { workspace: finalWorkspace, packages: merged };
  }

  async function checkPackage(pkg: PackageInfo, workspace: WorkspaceInfo): Promise<PackageHealthReport> {
    emit({ type: 'package:start', packageId: pkg.id });
    const results: HealthCheckResult[] = [];

    for (const check of host.checks) {
      emit({ type: 'check:start', packageId: pkg.id, checkId: check.id });
      const start = Date.now();
      let result: HealthCheckResult;
      try {
        const outcome = await check.run({ package: pkg, workspace, host: ctx });
        result = { checkId: check.id, label: check.label, durationMs: Date.now() - start, ...outcome };
      } catch (err) {
        result = {
          checkId: check.id,
          label: check.label,
          status: 'unknown',
          severity: check.severity,
          summary: 'Check threw an exception',
          evidence: [err instanceof Error ? (err.stack ?? err.message) : String(err)],
          durationMs: Date.now() - start,
        };
      }
      results.push(result);
      emit({ type: 'check:done', packageId: pkg.id, result });
    }

    const report = buildReport(pkg, results, now());
    emit({ type: 'package:done', report });
    return report;
  }

  async function run(): Promise<WorkbenchRun> {
    const startedAt = now();
    emit({ type: 'run:start', cwd: opts.cwd });

    const { workspace, packages } = await inspect();
    const reports: PackageHealthReport[] = [];
    for (const pkg of packages) reports.push(await checkPackage(pkg, workspace));

    const workbenchRun: WorkbenchRun = {
      id: `run-${startedAt}`,
      workspace,
      reports,
      summary: summarize(reports),
      startedAt,
      finishedAt: now(),
    };
    emit({ type: 'run:done', run: workbenchRun });
    return workbenchRun;
  }

  return {
    host,
    on(listener) {
      emitter.on('event', listener);
      return () => emitter.off('event', listener);
    },
    inspect,
    checkPackage,
    run,
  };
}
