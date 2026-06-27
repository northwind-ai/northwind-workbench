/**
 * Scenario model — executable smoke tests that prove a package does something
 * useful, not just that it loads. Scenarios are the core differentiator: a
 * plugin contributes domain-specific scenarios (e.g. "revenue report returns
 * opportunities") and Workbench runs them and folds the pass rate into health.
 *
 * Types + pure helpers only. The runner lives in `@package-workbench/core`.
 */

import type { PackageInfo, PluginContext, WorkspaceInfo } from "./index";

/** Built-in assertion operators. `custom_function` defers to a user predicate. */
export type AssertionOperator =
  | "equals"
  | "exists"
  | "type_is"
  | "array_length"
  | "greater_than"
  | "less_than"
  | "contains"
  | "custom_function";

/**
 * One assertion against a scenario's produced value.
 *
 * `path` is an optional dot/bracket path into the value (e.g. `data.items.0.id`);
 * omit it to assert against the whole value. `expected` is interpreted per
 * operator (the comparand for `equals`/`greater_than`, the type name for
 * `type_is`, the length for `array_length`, the needle for `contains`).
 */
export interface ScenarioAssertion {
  path?: string;
  operator: AssertionOperator;
  expected?: unknown;
  /** For `custom_function`: return true to pass, or a string failure message. */
  fn?: (actual: unknown, ctx: ScenarioRunnerContext) => boolean | string;
  /** Optional human description, surfaced in failure output. */
  message?: string;
}

/**
 * Minimal structural view of the `AbortSignal` global. Declared locally so the
 * SDK stays dependency-free (no `dom`/`node` libs); a real `AbortSignal` from
 * Node or the browser is structurally assignable to it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** Why a scenario failed — drives UI grouping and remediation hints. */
export type ScenarioFailureCategory =
  | "setup"
  | "runtime"
  | "assertion"
  | "timeout"
  | "cancelled";

/** Lifecycle/terminal state of a single scenario. */
export type ScenarioStatus = "pass" | "fail" | "skip" | "running" | "pending";

/** Everything a scenario's `run()` receives from the host. */
export interface ScenarioRunnerContext {
  readonly package: PackageInfo;
  readonly workspace: WorkspaceInfo;
  readonly host: PluginContext;
  /** Aborts when the scenario times out or the run is cancelled. */
  readonly signal: AbortSignalLike;
  /** Append a line to the scenario's captured log. */
  log(message: string): void;
}

/**
 * A declarative, executable smoke test.
 *
 * `run()` performs the work (import the package, call a function, hit an API…)
 * and returns the value that `assertions` are evaluated against. Returning a
 * value is optional — a scenario can also just `throw` to fail, or rely on
 * assertions with explicit `fn`s.
 */
export interface ScenarioDefinition {
  id: string;
  title: string;
  description?: string;
  /** Hard wall-clock cap; the runner aborts the signal and marks `timeout`. */
  timeoutMs?: number;
  tags?: string[];
  /** Free-form input echoed into results/logs for traceability. */
  input?: unknown;
  /** Free-form expected summary (documentation; assertions do the checking). */
  expected?: unknown;
  assertions?: ScenarioAssertion[];
  run(ctx: ScenarioRunnerContext): Promise<unknown> | unknown;
}

/** The evaluated outcome of one assertion. */
export interface AssertionResult {
  ok: boolean;
  operator: AssertionOperator;
  path?: string;
  expected?: unknown;
  actual?: unknown;
  /** Human-readable line, e.g. `Expected opportunityCount > 0, actual: 0`. */
  message: string;
}

/** The result of running one scenario. */
export interface ScenarioResult {
  id: string;
  title: string;
  status: Exclude<ScenarioStatus, "running" | "pending">;
  /** Set when `status === 'fail'`. */
  category?: ScenarioFailureCategory;
  durationMs: number;
  /** Heap delta during the scenario, in bytes (best effort, in-process only). */
  memoryBytes?: number;
  assertions: AssertionResult[];
  logs: string[];
  error?: { type: string; message: string; stack?: string };
}

/** Aggregate result of running a set of scenarios for one package. */
export interface ScenarioRunResult {
  packageId: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 0..1 — passed / (total - skipped). 1 when nothing was runnable. */
  passRate: number;
  durationMs: number;
  results: ScenarioResult[];
}

/** Identity helper for type inference + a stable, evolvable signature. */
export const defineScenario = (
  scenario: ScenarioDefinition,
): ScenarioDefinition => scenario;

/** Convenience: percentage form of a pass rate, rounded. */
export const passRatePercent = (
  run: Pick<ScenarioRunResult, "passRate">,
): number => Math.round(run.passRate * 100);
