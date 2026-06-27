import { EventEmitter } from "node:events";
import type {
  HealthCheckResult,
  PackageInfo,
  Plugin,
  PluginContext,
  WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import { PluginHost } from "./registry";
import { createNodeContext } from "./context";
import { buildReport, summarize } from "./scoring";
import { scanWorkspace } from "./scanner";
import { builtinChecks } from "./checks";
import { builtinPlugins } from "./plugins";
import { loadWorkspacePlugins, type PluginLoadError } from "./plugins/load";
import { buildRuntimeReport, type BuildRuntimeReportOptions } from "./runtime";
import {
  runScenarios as runScenarioSet,
  type RunScenariosOptions,
} from "./scenarios";
import { analyzeDependencyGraph, loadBoundaryRules } from "./graph";
import type { PackageHealthReport, RunnerEvent, WorkbenchRun } from "./types";
import type {
  BoundaryRule,
  DependencyGraph,
  RuntimeCompatibilityReport,
  ScenarioDefinition,
  ScenarioRunResult,
} from "@package-workbench/plugin-sdk";

export interface RunnerOptions {
  cwd: string;
  /** Extra plugins (adapters/checks). Loaded after built-ins. */
  plugins?: Plugin[];
  /** Set false to drop the built-in checks. */
  includeBuiltins?: boolean;
  /** Discover plugins from `workbench.config.*` / package.json. Default false. */
  discoverPlugins?: boolean;
  /** Explicit boundary rules; otherwise loaded from config during analyzeGraph. */
  boundaryRules?: BoundaryRule[];
  /** Inject a custom context (e.g. for tests). Defaults to the Node context. */
  context?: PluginContext;
  /** Supplies run id + timestamps (kept injectable so runs stay testable). */
  clock?: () => string;
}

export interface Runner {
  readonly host: PluginHost;
  on(listener: (event: RunnerEvent) => void): () => void;
  inspect(): Promise<{ workspace: WorkspaceInfo; packages: PackageInfo[] }>;
  checkPackage(
    pkg: PackageInfo,
    workspace: WorkspaceInfo,
    opts?: { signal?: AbortSignal },
  ): Promise<PackageHealthReport>;
  /** Build the runtime compatibility report for one package (may execute it). */
  analyzeRuntime(
    pkg: PackageInfo,
    opts?: BuildRuntimeReportOptions,
  ): Promise<RuntimeCompatibilityReport>;
  /** Scenarios contributed by plugins that support the package. */
  scenariosFor(pkg: PackageInfo): ScenarioDefinition[];
  /** Run a package's scenarios and aggregate the result. `only` limits to ids. */
  runScenarios(
    pkg: PackageInfo,
    workspace: WorkspaceInfo,
    opts?: RunScenariosOptions & { only?: string[] },
  ): Promise<ScenarioRunResult>;
  /** Build the workspace dependency graph + analysis. */
  analyzeGraph(packages?: PackageInfo[]): Promise<DependencyGraph>;
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
  const emit = (e: RunnerEvent) => emitter.emit("event", e);

  const corePlugin: Plugin = {
    id: "@package-workbench/core",
    name: "@package-workbench/core",
    checks: builtinChecks,
  };
  const host = new PluginHost([
    ...(opts.includeBuiltins === false ? [] : [corePlugin, ...builtinPlugins]),
    ...(opts.plugins ?? []),
  ]);

  /** Plugin-load problems surfaced during discovery (attached to workspace warnings). */
  const pluginErrors: PluginLoadError[] = [];
  let discovered = false;

  async function discover(workspaceWarnings: string[]): Promise<void> {
    if (discovered || !opts.discoverPlugins) return;
    discovered = true;
    const { plugins, errors } = await loadWorkspacePlugins(opts.cwd);
    for (const p of plugins) host.register(p);
    pluginErrors.push(...errors);
    for (const e of errors)
      workspaceWarnings.push(
        `Plugin "${e.source}" failed to load: ${e.message}`,
      );
  }

  async function inspect(): Promise<{
    workspace: WorkspaceInfo;
    packages: PackageInfo[];
  }> {
    const { workspace, packages } = await scanWorkspace(opts.cwd);
    await discover(workspace.warnings);

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
        workspace.warnings.push(
          `Adapter "${adapter.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const merged = [...byRoot.values()];
    const finalWorkspace = { ...workspace, packageCount: merged.length };
    emit({ type: "workspace:detected", workspace: finalWorkspace });
    return { workspace: finalWorkspace, packages: merged };
  }

  async function checkPackage(
    pkg: PackageInfo,
    workspace: WorkspaceInfo,
    checkOpts?: { signal?: AbortSignal },
  ): Promise<PackageHealthReport> {
    emit({ type: "package:start", packageId: pkg.id });
    const results: HealthCheckResult[] = [];
    const checks = host.checksFor(pkg);
    const scenarios = host.scenariosFor(pkg);

    for (const check of checks) {
      emit({ type: "check:start", packageId: pkg.id, checkId: check.id });
      const start = Date.now();
      let result: HealthCheckResult;
      try {
        const outcome = await check.run({
          package: pkg,
          workspace,
          host: ctx,
          scenarios,
          signal: checkOpts?.signal,
        });
        result = {
          checkId: check.id,
          label: check.label,
          durationMs: Date.now() - start,
          ...outcome,
        };
      } catch (err) {
        result = {
          checkId: check.id,
          label: check.label,
          status: "unknown",
          severity: check.severity,
          summary: "Check threw an exception",
          evidence: [
            err instanceof Error ? (err.stack ?? err.message) : String(err),
          ],
          durationMs: Date.now() - start,
        };
      }
      results.push(result);
      emit({ type: "check:done", packageId: pkg.id, result });
    }

    const report = buildReport(pkg, results, now());
    emit({ type: "package:done", report });
    return report;
  }

  async function run(): Promise<WorkbenchRun> {
    const startedAt = now();
    emit({ type: "run:start", cwd: opts.cwd });

    const { workspace, packages } = await inspect();
    const reports: PackageHealthReport[] = [];
    for (const pkg of packages)
      reports.push(await checkPackage(pkg, workspace));

    const workbenchRun: WorkbenchRun = {
      id: `run-${startedAt}`,
      workspace,
      reports,
      summary: summarize(reports),
      startedAt,
      finishedAt: now(),
    };
    emit({ type: "run:done", run: workbenchRun });
    return workbenchRun;
  }

  return {
    host,
    on(listener) {
      emitter.on("event", listener);
      return () => emitter.off("event", listener);
    },
    inspect,
    checkPackage,
    analyzeRuntime: (pkg, runtimeOpts) => buildRuntimeReport(pkg, runtimeOpts),
    scenariosFor: (pkg) => host.scenariosFor(pkg),
    async runScenarios(pkg, workspace, scenarioOpts) {
      const only = scenarioOpts?.only;
      const scenarios = host
        .scenariosFor(pkg)
        .filter((s) => !only || only.includes(s.id));
      return runScenarioSet(
        scenarios,
        { package: pkg, workspace, host: ctx },
        scenarioOpts,
      );
    },
    async analyzeGraph(packages) {
      const pkgs = packages ?? (await inspect()).packages;
      const rules = opts.boundaryRules ?? (await loadBoundaryRules(opts.cwd));
      return analyzeDependencyGraph(pkgs, { workspaceRoot: opts.cwd, rules });
    },
    run,
  };
}
