import type {
  DependencyGraph,
  EngineHostStatus,
  EngineProgress,
  FailureExplanation,
  HistoricalRun,
  PackageIntelligenceReport,
  PrReview,
  RefactorPlan,
  FixPlan,
  FixCandidate,
  FixResult,
  PackageHealthReport,
  RunDelta,
  RuntimeCompatibilityReport,
  ScenarioRunResult,
  WorkbenchRun,
  WorkspaceStack,
} from "@package-workbench/core";
import type { ChatAnswer } from "@package-workbench/chat-engine";

/** Channel names — the single source of truth shared by main + preload. */
export const Channels = {
  getInitialRun: "workbench:getInitialRun",
  openWorkspace: "workbench:openWorkspace",
  openExample: "workbench:openExample",
  exportReport: "workbench:exportReport",
  scan: "workbench:scan",
  runAll: "workbench:runAll",
  runPackage: "workbench:runPackage",
  analyzeRuntime: "workbench:analyzeRuntime",
  listScenarios: "workbench:listScenarios",
  runScenarios: "workbench:runScenarios",
  runScenario: "workbench:runScenario",
  analyzeGraph: "workbench:analyzeGraph",
  explainRun: "workbench:explainRun",
  reviewPr: "workbench:reviewPr",
  detectStack: "workbench:detectStack",
  analyzeIntel: "workbench:analyzeIntel",
  analyzeRefactor: "workbench:analyzeRefactor",
  findFixes: "workbench:findFixes",
  applyFix: "workbench:applyFix",
  undoFix: "workbench:undoFix",
  chat: "workbench:chat",
  historyList: "workbench:historyList",
  historyCompare: "workbench:historyCompare",
  openLogsFolder: "workbench:openLogsFolder",
  logError: "workbench:logError",
  cancel: "workbench:cancel",
  engineStatus: "workbench:engineStatus",
  engineProgress: "workbench:engineProgress",
} as const;

/** Lightweight scenario descriptor (functions can't cross the IPC boundary). */
export interface ScenarioMetaDto {
  id: string;
  title: string;
}

/** Engine worker status enriched with live process metrics for the UI. */
export type EngineStatusDto = EngineHostStatus & {
  memoryMb?: number;
  cpuPercent?: number;
};

/**
 * The typed bridge exposed to the renderer as `window.workbench`. The renderer
 * speaks ONLY this surface — never Node, never ipcRenderer, never the filesystem.
 * All FS access + code execution happens in the main process.
 */
export interface WorkbenchApi {
  /** The run shown on first launch (built-in mock data). */
  getInitialRun(): Promise<WorkbenchRun>;
  /** Show a folder picker, scan the chosen workspace. Null if cancelled. */
  openWorkspace(): Promise<WorkbenchRun | null>;
  /** Load the bundled example workspace (falls back to the demo run). */
  openExample(): Promise<WorkbenchRun>;
  /** Render the current run as a Markdown report and save it. Returns the path or null. */
  exportReport(): Promise<string | null>;
  /** Scan an explicit path. */
  scan(path: string): Promise<WorkbenchRun>;
  /** Re-run the currently loaded workspace (mock if none opened yet). */
  runAll(): Promise<WorkbenchRun>;
  /** Re-run checks for a single package; returns the updated report. */
  runPackage(packageId: string): Promise<PackageHealthReport | null>;
  /** Build the runtime compatibility matrix for a package (executes it). */
  analyzeRuntime(packageId: string): Promise<RuntimeCompatibilityReport | null>;
  /** List scenarios available for a package (from plugins). */
  listScenarios(packageId: string): Promise<ScenarioMetaDto[]>;
  /** Run all of a package's scenarios. */
  runScenarios(packageId: string): Promise<ScenarioRunResult | null>;
  /** Run a single scenario by id. */
  runScenario(
    packageId: string,
    scenarioId: string,
  ): Promise<ScenarioRunResult | null>;
  /** Build the workspace dependency graph + analysis. */
  analyzeGraph(): Promise<DependencyGraph | null>;
  /** AI failure analysis for the current run: ranked root causes + fixes. */
  explainRun(): Promise<FailureExplanation[]>;
  /** PR review: compare the current run against the stored baseline. Null if no baseline. */
  reviewPr(): Promise<PrReview | null>;
  /** Detect the workspace adapter stack for the current workspace. */
  detectStack(): Promise<WorkspaceStack | null>;
  /** Package intelligence (exports/usage/size/deps) across the workspace. */
  analyzeIntel(): Promise<PackageIntelligenceReport | null>;
  /** Refactor Architect plans. `alternatives` returns all variants. */
  analyzeRefactor(alternatives: boolean): Promise<RefactorPlan[]>;
  /** Detect auto-fix candidates (no application). */
  findFixes(): Promise<FixPlan | null>;
  /** Apply a single fix candidate. `allowReview` permits review-required fixes. */
  applyFix(candidate: FixCandidate, allowReview: boolean): Promise<FixResult>;
  /** Roll back the most recent applied fix group. Returns the group id or null. */
  undoFix(): Promise<string | null>;
  /** Ask the AI Codebase Chat a question (uses cached knowledge + session). */
  chat(question: string): Promise<ChatAnswer | null>;
  /** Stored historical runs, newest first. */
  listRuns(): Promise<HistoricalRun[]>;
  /** Compare two stored runs (previous → current). */
  compareRuns(previousId: string, currentId: string): Promise<RunDelta | null>;
  /** Open the folder containing the app log files. */
  openLogsFolder(): Promise<void>;
  /** Report a renderer-side error to the main-process log. */
  logError(scope: string, message: string): Promise<void>;
  /** Cancel the in-flight engine task(s). */
  cancel(): Promise<void>;
  /** Current engine worker status (with live metrics). */
  engineStatus(): Promise<EngineStatusDto>;
  /** Subscribe to granular engine progress. Returns an unsubscribe fn. */
  onEngineProgress(listener: (p: EngineProgress) => void): () => void;
  /** Subscribe to engine worker status changes (ready/crashed/… + metrics). */
  onEngineStatus(listener: (s: EngineStatusDto) => void): () => void;
}
