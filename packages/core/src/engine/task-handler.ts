import { createRunner } from "../runner";
import { summarize } from "../scoring";
import { renderReport } from "../history/report";
import { createFailureAssistant } from "../ai/assistant";
import { fromRun } from "../ai/normalize";
import { analyzePackageIntelligence } from "../intel/analyze";
import { analyzeRefactor, generateAlternativePlans } from "../refactor/plan";
import { detectFixes } from "../fix/detectors";
import { buildFixPlan } from "../fix/plan";
import type { WorkbenchRun } from "../types";
import type {
  EnginePhase,
  EnginePayload,
  EngineResult,
  EngineTaskType,
} from "./protocol";

/**
 * Executes a single engine task. Pure orchestration over the existing core
 * runner — but it drives the per-package loop itself so it can emit *granular*
 * progress and honour cancellation between (and inside) packages. This is the
 * function the isolated worker runs; it has no Electron dependency, so it is
 * unit-testable directly.
 */

class CancelledError extends Error {
  override name = "CancelledError";
}
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError("Task cancelled");
}

export interface TaskContext {
  signal: AbortSignal;
  onProgress(p: {
    progress: number;
    phase: EnginePhase;
    message?: string;
    completed?: number;
    total?: number;
  }): void;
}

export interface TaskHandlerOptions {
  /** Injectable clock for deterministic runs/tests. */
  now?: () => string;
}

export type TaskHandler = <T extends EngineTaskType>(
  type: T,
  payload: EnginePayload<T>,
  ctx: TaskContext,
) => Promise<EngineResult<T>>;

export function createTaskHandler(opts: TaskHandlerOptions = {}): TaskHandler {
  const now = opts.now ?? (() => new Date().toISOString());

  async function scan(
    payload: EnginePayload<"RUN_SCAN">,
    ctx: TaskContext,
  ): Promise<WorkbenchRun> {
    const runner = createRunner({ cwd: payload.cwd, discoverPlugins: true });
    ctx.onProgress({
      progress: 2,
      phase: "workspace_scan",
      message: "Scanning workspace",
    });
    throwIfAborted(ctx.signal);

    const { workspace, packages } = await runner.inspect();
    ctx.onProgress({
      progress: 8,
      phase: "package_discovery",
      message: `${packages.length} package(s) discovered`,
      completed: 0,
      total: packages.length,
    });

    if (payload.runScenarios) process.env.PW_RUN_SCENARIOS = "1";
    const reports = [];
    for (let i = 0; i < packages.length; i++) {
      throwIfAborted(ctx.signal);
      const pkg = packages[i]!;
      let report = await runner.checkPackage(pkg, workspace, {
        signal: ctx.signal,
      });
      if (payload.runScenarios && runner.scenariosFor(pkg).length > 0) {
        report = {
          ...report,
          scenarios: await runner.runScenarios(pkg, workspace, {
            signal: ctx.signal,
          }),
        };
      }
      reports.push(report);
      const frac = (i + 1) / Math.max(1, packages.length);
      ctx.onProgress({
        progress: 8 + 70 * frac,
        phase: "health_checks",
        message: pkg.name,
        completed: i + 1,
        total: packages.length,
      });
    }

    let graph;
    if (payload.includeGraph !== false) {
      ctx.onProgress({
        progress: 82,
        phase: "dependency_graph",
        message: "Building dependency graph",
      });
      throwIfAborted(ctx.signal);
      graph = await runner.analyzeGraph(packages);
    }

    ctx.onProgress({
      progress: 98,
      phase: "report_generation",
      message: "Finalising",
    });
    const at = now();
    return {
      id: `run-${at}`,
      workspace,
      reports,
      summary: summarize(reports),
      startedAt: at,
      finishedAt: at,
      graph,
    };
  }

  async function withPackage<R>(
    cwd: string,
    packageId: string,
    fn: (args: {
      runner: ReturnType<typeof createRunner>;
      pkg: import("@package-workbench/plugin-sdk").PackageInfo;
      workspace: import("@package-workbench/plugin-sdk").WorkspaceInfo;
    }) => Promise<R>,
  ): Promise<R | null> {
    const runner = createRunner({ cwd, discoverPlugins: true });
    const { workspace, packages } = await runner.inspect();
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return null;
    return fn({ runner, pkg, workspace });
  }

  return async function handle(type, payload, ctx) {
    switch (type) {
      case "RUN_SCAN":
        return (await scan(
          payload as EnginePayload<"RUN_SCAN">,
          ctx,
        )) as EngineResult<typeof type>;

      case "RUN_GRAPH": {
        const p = payload as EnginePayload<"RUN_GRAPH">;
        ctx.onProgress({ progress: 10, phase: "workspace_scan" });
        const runner = createRunner({ cwd: p.cwd, discoverPlugins: true });
        const { packages } = await runner.inspect();
        ctx.onProgress({
          progress: 50,
          phase: "dependency_graph",
          total: packages.length,
        });
        const graph = await runner.analyzeGraph(packages);
        ctx.onProgress({ progress: 100, phase: "dependency_graph" });
        return graph as EngineResult<typeof type>;
      }

      case "RUN_PACKAGE": {
        const p = payload as EnginePayload<"RUN_PACKAGE">;
        ctx.onProgress({
          progress: 20,
          phase: "health_checks",
          message: p.packageId,
        });
        const result = await withPackage(
          p.cwd,
          p.packageId,
          ({ runner, pkg, workspace }) =>
            runner.checkPackage(pkg, workspace, { signal: ctx.signal }),
        );
        ctx.onProgress({ progress: 100, phase: "health_checks" });
        return result as EngineResult<typeof type>;
      }

      case "RUN_RUNTIME": {
        const p = payload as EnginePayload<"RUN_RUNTIME">;
        ctx.onProgress({
          progress: 20,
          phase: "runtime_checks",
          message: p.packageId,
        });
        throwIfAborted(ctx.signal);
        const result = await withPackage(
          p.cwd,
          p.packageId,
          ({ runner, pkg }) => runner.analyzeRuntime(pkg, { execute: true }),
        );
        ctx.onProgress({ progress: 100, phase: "runtime_checks" });
        return result as EngineResult<typeof type>;
      }

      case "RUN_SCENARIOS": {
        const p = payload as EnginePayload<"RUN_SCENARIOS">;
        process.env.PW_RUN_SCENARIOS = "1";
        ctx.onProgress({
          progress: 20,
          phase: "scenarios",
          message: p.packageId,
        });
        const result = await withPackage(
          p.cwd,
          p.packageId,
          ({ runner, pkg, workspace }) =>
            runner.runScenarios(pkg, workspace, {
              only: p.only,
              signal: ctx.signal,
            }),
        );
        ctx.onProgress({ progress: 100, phase: "scenarios" });
        return result as EngineResult<typeof type>;
      }

      case "RUN_REPORT": {
        const p = payload as EnginePayload<"RUN_REPORT">;
        ctx.onProgress({ progress: 50, phase: "report_generation" });
        const content = renderReport({ run: p.run }, p.format);
        ctx.onProgress({ progress: 100, phase: "report_generation" });
        return { content } as EngineResult<typeof type>;
      }

      case "EXPLAIN_RUN": {
        const p = payload as EnginePayload<"EXPLAIN_RUN">;
        ctx.onProgress({
          progress: 20,
          phase: "report_generation",
          message: "Analyzing failures",
        });
        const assistant = createFailureAssistant({ memory: p.cwd, now });
        const explanations = await assistant.analyzeMany(fromRun(p.run));
        ctx.onProgress({ progress: 100, phase: "report_generation" });
        return explanations as EngineResult<typeof type>;
      }

      case "ANALYZE_INTEL": {
        const p = payload as EnginePayload<"ANALYZE_INTEL">;
        ctx.onProgress({
          progress: 15,
          phase: "package_discovery",
          message: "Analyzing API surface + size",
        });
        const runner = createRunner({ cwd: p.cwd, discoverPlugins: true });
        const { packages } = await runner.inspect();
        const report = await analyzePackageIntelligence(packages, { now });
        ctx.onProgress({ progress: 100, phase: "report_generation" });
        return report as EngineResult<typeof type>;
      }

      case "ANALYZE_REFACTOR": {
        const p = payload as EnginePayload<"ANALYZE_REFACTOR">;
        ctx.onProgress({
          progress: 15,
          phase: "dependency_graph",
          message: "Analyzing architecture",
        });
        const runner = createRunner({ cwd: p.cwd, discoverPlugins: true });
        const { packages } = await runner.inspect();
        const graph = await runner.analyzeGraph(packages);
        let intel;
        try {
          intel = (await analyzePackageIntelligence(packages, { size: false, now })).usage;
        } catch {
          intel = undefined;
        }
        ctx.onProgress({ progress: 70, phase: "report_generation" });
        const plans = p.alternatives ? generateAlternativePlans({ graph, intel, now }) : [analyzeRefactor({ graph, intel, now })];
        ctx.onProgress({ progress: 100, phase: "report_generation" });
        return plans as EngineResult<typeof type>;
      }

      case "FIND_FIXES": {
        const p = payload as EnginePayload<"FIND_FIXES">;
        const run = await scan({ cwd: p.cwd, includeGraph: false }, ctx);
        ctx.onProgress({ progress: 80, phase: "report_generation", message: "Detecting fixes" });
        let intel;
        try {
          intel = await analyzePackageIntelligence(run.reports.map((r) => r.package), { size: false, now });
        } catch {
          intel = undefined;
        }
        const candidates = await detectFixes({ run, intel });
        ctx.onProgress({ progress: 100, phase: "report_generation" });
        return buildFixPlan(candidates, now) as EngineResult<typeof type>;
      }

      default:
        throw new Error(`Unknown engine task: ${type}`);
    }
  };
}

export { CancelledError };
