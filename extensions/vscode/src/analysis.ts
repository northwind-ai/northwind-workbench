import * as vscode from "vscode";
import {
  createRunner,
  summarize,
  analyzePackageIntelligence,
  detectFixes,
  buildFixPlan,
  analyzeRefactor,
  detectWorkspaceStack,
  type DependencyGraph,
  type FixPlan,
  type PackageIntelligenceReport,
  type RefactorPlan,
  type WorkbenchRun,
  type WorkspaceStack,
} from "@package-workbench/core";

/**
 * The bridge to Package Workbench core. It orchestrates the existing engines —
 * runner, dependency graph, package intelligence, auto-fix, refactor architect,
 * adapter detection — and caches the result. It NEVER re-implements analysis;
 * every result comes from core.
 *
 * Responsiveness (a hard requirement): analysis runs in the background off the
 * editor's critical path, concurrent requests are de-duplicated, and edits
 * trigger a debounced refresh rather than blocking.
 */

export interface WorkspaceAnalysis {
  run: WorkbenchRun;
  graph?: DependencyGraph;
  intel?: PackageIntelligenceReport;
  fixPlan: FixPlan;
  refactor?: RefactorPlan;
  stack?: WorkspaceStack;
  analyzedAt: string;
}

export class AnalysisService {
  private current: WorkspaceAnalysis | null = null;
  private inFlight: Promise<WorkspaceAnalysis | null> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  private readonly _onDidChange =
    new vscode.EventEmitter<WorkspaceAnalysis | null>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly output: vscode.OutputChannel,
  ) {}

  getAnalysis(): WorkspaceAnalysis | null {
    return this.current;
  }

  /** Run a full analysis. Concurrent calls share one run (caching). */
  async analyze(): Promise<WorkspaceAnalysis | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Debounced re-analysis after edits — keeps the editor responsive. */
  scheduleRefresh(debounceMs: number): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(
      () => void this.analyze(),
      Math.max(100, debounceMs),
    );
  }

  private async run(): Promise<WorkspaceAnalysis | null> {
    const started = Date.now();
    try {
      const runner = createRunner({
        cwd: this.workspaceRoot,
        discoverPlugins: true,
      });
      const { workspace, packages } = await runner.inspect();
      if (packages.length === 0) {
        this.output.appendLine("No packages discovered.");
        this.current = null;
        this._onDidChange.fire(null);
        return null;
      }

      // Health checks (skip the heavy runtime-import execution to stay snappy).
      const prevNoRuntime = process.env.PW_NO_RUNTIME;
      process.env.PW_NO_RUNTIME = "1";
      const reports = [];
      for (const pkg of packages)
        reports.push(await runner.checkPackage(pkg, workspace));
      if (prevNoRuntime === undefined) delete process.env.PW_NO_RUNTIME;
      else process.env.PW_NO_RUNTIME = prevNoRuntime;

      const now = new Date().toISOString();
      const run: WorkbenchRun = {
        id: `vscode-${now}`,
        workspace,
        reports,
        summary: summarize(reports),
        startedAt: now,
        finishedAt: now,
      };

      const graph = await runner.analyzeGraph(packages);
      run.graph = graph;

      let intel: PackageIntelligenceReport | undefined;
      try {
        intel = await analyzePackageIntelligence(packages, { size: false });
      } catch {
        intel = undefined;
      }

      const fixPlan = buildFixPlan(await detectFixes({ run, intel }));
      const refactor = analyzeRefactor({ graph, intel: intel?.usage });
      const stack = await detectWorkspaceStack(this.workspaceRoot).catch(
        () => undefined,
      );

      this.current = {
        run,
        graph,
        intel,
        fixPlan,
        refactor,
        stack,
        analyzedAt: now,
      };
      this.output.appendLine(
        `Analyzed ${packages.length} package(s) in ${Date.now() - started}ms.`,
      );
      this._onDidChange.fire(this.current);
      return this.current;
    } catch (err) {
      this.output.appendLine(
        `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.current;
    }
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this._onDidChange.dispose();
  }
}
