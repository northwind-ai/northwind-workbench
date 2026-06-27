import type {
  DependencyGraph,
  RuntimeCompatibilityReport,
  ScenarioRunResult,
} from "@package-workbench/plugin-sdk";
import type { PackageHealthReport, WorkbenchRun } from "../types";
import type { ReportFormat } from "../history/report";
import type { FailureExplanation } from "../ai/types";
import type { PackageIntelligenceReport } from "../intel/types";
import type { RefactorPlan } from "../refactor/types";
import type { FixPlan } from "../fix/types";

/**
 * The strongly-typed protocol spoken between the Electron main process (the
 * {@link EngineHost}) and the isolated engine worker. Keeping it here — pure,
 * Electron-free — lets both sides share the types and lets the host + handler be
 * unit-tested over an in-process transport.
 */

/** Granular phases reported as a task progresses. */
export type EnginePhase =
  | "workspace_scan"
  | "package_discovery"
  | "health_checks"
  | "runtime_checks"
  | "dependency_graph"
  | "scenarios"
  | "report_generation";

/** The kinds of work the engine can be asked to do. */
export type EngineTaskType =
  | "RUN_SCAN"
  | "RUN_PACKAGE"
  | "RUN_RUNTIME"
  | "RUN_SCENARIOS"
  | "RUN_GRAPH"
  | "RUN_REPORT"
  | "EXPLAIN_RUN"
  | "ANALYZE_INTEL"
  | "ANALYZE_REFACTOR"
  | "FIND_FIXES";

/** Per-task payload + result shapes. */
export interface EngineTaskMap {
  RUN_SCAN: {
    payload: { cwd: string; includeGraph?: boolean; runScenarios?: boolean };
    result: WorkbenchRun;
  };
  RUN_PACKAGE: {
    payload: { cwd: string; packageId: string };
    result: PackageHealthReport | null;
  };
  RUN_RUNTIME: {
    payload: { cwd: string; packageId: string };
    result: RuntimeCompatibilityReport | null;
  };
  RUN_SCENARIOS: {
    payload: { cwd: string; packageId: string; only?: string[] };
    result: ScenarioRunResult | null;
  };
  RUN_GRAPH: { payload: { cwd: string }; result: DependencyGraph };
  RUN_REPORT: {
    payload: { run: WorkbenchRun; format: ReportFormat };
    result: { content: string };
  };
  /** AI failure analysis over an already-computed run; reads workspace memory for prior fixes. */
  EXPLAIN_RUN: {
    payload: { run: WorkbenchRun; cwd: string };
    result: FailureExplanation[];
  };
  /** Package intelligence (exports/usage/size/deps) across the workspace. */
  ANALYZE_INTEL: {
    payload: { cwd: string };
    result: PackageIntelligenceReport;
  };
  /** Refactor Architect: architectural problems + ranked plans (all variants). */
  ANALYZE_REFACTOR: {
    payload: { cwd: string; alternatives?: boolean };
    result: RefactorPlan[];
  };
  /** Auto Fix: detect safe/review/dangerous fix candidates (no application). */
  FIND_FIXES: { payload: { cwd: string }; result: FixPlan };
}

export type EnginePayload<T extends EngineTaskType> =
  EngineTaskMap[T]["payload"];
export type EngineResult<T extends EngineTaskType> = EngineTaskMap[T]["result"];

/** Stable error classification surfaced to the host/UI. */
export type EngineErrorType =
  | "PROCESS_CRASH"
  | "TIMEOUT"
  | "CANCELLED"
  | "TASK_ERROR"
  | "WORKER_UNAVAILABLE";

/** A progress update for a task (0..100). */
export interface EngineProgress {
  id: string;
  progress: number;
  phase: EnginePhase;
  message?: string;
  /** Items completed / total, when the phase is item-wise (e.g. packages). */
  completed?: number;
  total?: number;
}

// ---- wire messages -----------------------------------------------------------

/** main → worker. */
export type WorkerInbound =
  | { kind: "request"; id: string; type: EngineTaskType; payload: unknown }
  | { kind: "cancel"; id: string }
  | { kind: "ping"; nonce: number }
  | { kind: "shutdown" };

/** worker → main. */
export type WorkerOutbound =
  | { kind: "ready" }
  | ({ kind: "progress" } & EngineProgress)
  | { kind: "response"; id: string; result: unknown }
  | {
      kind: "error";
      id: string;
      errorType: EngineErrorType;
      message: string;
      stack?: string;
    }
  | { kind: "pong"; nonce: number };

/** A structured engine error (what the host rejects task promises with). */
export class EngineError extends Error {
  constructor(
    readonly errorType: EngineErrorType,
    message: string,
    /** The last progress seen before failure, for partial recovery. */
    readonly lastProgress?: EngineProgress,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
