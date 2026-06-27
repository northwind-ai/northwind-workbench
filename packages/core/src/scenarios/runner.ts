import type {
  PackageInfo,
  PluginContext,
  ScenarioDefinition,
  ScenarioFailureCategory,
  ScenarioResult,
  ScenarioRunnerContext,
  ScenarioRunResult,
  WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import { evaluateAssertion } from "./assertions";

/**
 * The scenario runner. Executes scenarios in-process (the v1 trust model — same
 * as plugins), with per-scenario timeouts, cooperative cancellation, optional
 * bounded parallelism, and categorised failures.
 *
 * In-process keeps the API trivial and lets scenarios share imported modules.
 * The documented upgrade path (mirroring plugins) is to run scenarios inside a
 * `utilityProcess`/`worker_thread` for isolation.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_LOG_LINES = 500;

export interface RunScenariosOptions {
  /** Per-scenario fallback timeout (a scenario's own `timeoutMs` wins). */
  timeoutMs?: number;
  /** 1 = sequential (default). >1 = bounded parallelism. */
  concurrency?: number;
  /** Cancels the whole run; in-flight scenarios abort, the rest are skipped. */
  signal?: AbortSignalLikeNode;
  /** Called as each scenario finishes — for live UI progress. */
  onResult?: (result: ScenarioResult) => void;
  /** Injectable clock (ms). Defaults to Date.now. */
  clock?: () => number;
}

/** Local alias: Node's real AbortSignal satisfies the SDK's structural type. */
type AbortSignalLikeNode = AbortSignal;

interface BaseContext {
  package: PackageInfo;
  workspace: WorkspaceInfo;
  host: PluginContext;
}

class TimeoutError extends Error {
  override name = "TimeoutError";
}
class CancelledError extends Error {
  override name = "CancelledError";
}

function rejectOnAbort(signal: AbortSignal): {
  promise: Promise<never>;
  cleanup: () => void;
} {
  let handler: () => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    handler = () =>
      reject((signal.reason as Error) ?? new CancelledError("Aborted"));
    if (signal.aborted) handler();
    else signal.addEventListener("abort", handler);
  });
  return {
    promise,
    cleanup: () => signal.removeEventListener("abort", handler),
  };
}

/** Run a single scenario to a terminal {@link ScenarioResult}. Never throws. */
export async function runScenario(
  scenario: ScenarioDefinition,
  base: BaseContext,
  opts: RunScenariosOptions = {},
): Promise<ScenarioResult> {
  const clock = opts.clock ?? Date.now;
  const timeoutMs = scenario.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logs: string[] = [];
  const started = clock();
  const memBefore = safeHeap();

  // Already cancelled before we even start → skip.
  if (opts.signal?.aborted) {
    return finish("skip", {
      category: "cancelled",
      logs: ["Run cancelled before this scenario started"],
      started,
      clock,
      memBefore,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(new TimeoutError(`Scenario exceeded ${timeoutMs}ms`)),
    timeoutMs,
  );
  const onOuterAbort = () =>
    controller.abort(
      opts.signal?.reason ?? new CancelledError("Run cancelled"),
    );
  opts.signal?.addEventListener("abort", onOuterAbort);

  const ctx: ScenarioRunnerContext = {
    package: base.package,
    workspace: base.workspace,
    host: base.host,
    signal: controller.signal,
    log: (m) => {
      if (logs.length < MAX_LOG_LINES) logs.push(m);
    },
  };

  const abort = rejectOnAbort(controller.signal);
  try {
    const output = await Promise.race([
      Promise.resolve().then(() => scenario.run(ctx)),
      abort.promise,
    ]);

    // Run assertions.
    const assertions = (scenario.assertions ?? []).map((a) =>
      evaluateAssertion(a, output, ctx),
    );
    const failed = assertions.filter((a) => !a.ok);
    if (failed.length > 0) {
      return finish("fail", {
        category: "assertion",
        assertions,
        logs,
        started,
        clock,
        memBefore,
        error: {
          type: "AssertionError",
          message: failed.map((f) => f.message).join("; "),
        },
      });
    }
    return finish("pass", { assertions, logs, started, clock, memBefore });
  } catch (err) {
    const category: ScenarioFailureCategory =
      err instanceof TimeoutError
        ? "timeout"
        : err instanceof CancelledError
          ? "cancelled"
          : "runtime";
    const status = category === "cancelled" ? "skip" : "fail";
    const e = err as Error;
    return finish(status, {
      category,
      logs,
      started,
      clock,
      memBefore,
      error: {
        type: e?.name ?? "Error",
        message: e?.message ?? String(err),
        stack: e?.stack,
      },
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
    abort.cleanup();
  }

  function finish(
    status: ScenarioResult["status"],
    extra: {
      category?: ScenarioFailureCategory;
      assertions?: ScenarioResult["assertions"];
      logs: string[];
      started: number;
      clock: () => number;
      memBefore: number;
      error?: ScenarioResult["error"];
    },
  ): ScenarioResult {
    const memAfter = safeHeap();
    const result: ScenarioResult = {
      id: scenario.id,
      title: scenario.title,
      status,
      category: extra.category,
      durationMs: extra.clock() - extra.started,
      memoryBytes:
        memAfter > extra.memBefore ? memAfter - extra.memBefore : undefined,
      assertions: extra.assertions ?? [],
      logs: extra.logs,
      error: extra.error,
    };
    return result;
  }
}

function safeHeap(): number {
  try {
    return process.memoryUsage().heapUsed;
  } catch {
    return 0;
  }
}

/** Run a set of scenarios for one package and aggregate the results. */
export async function runScenarios(
  scenarios: ScenarioDefinition[],
  base: BaseContext,
  opts: RunScenariosOptions = {},
): Promise<ScenarioRunResult> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const results: ScenarioResult[] = new Array(scenarios.length);

  const runOne = async (i: number): Promise<void> => {
    const r = await runScenario(scenarios[i]!, base, opts);
    results[i] = r;
    opts.onResult?.(r);
  };

  if (concurrency === 1) {
    for (let i = 0; i < scenarios.length; i++) await runOne(i);
  } else {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < scenarios.length) {
        const i = next++;
        await runOne(i);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, scenarios.length) }, () =>
        worker(),
      ),
    );
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const runnable = results.length - skipped;
  const passRate = runnable === 0 ? 1 : passed / runnable;

  return {
    packageId: base.package.id,
    total: results.length,
    passed,
    failed,
    skipped,
    passRate,
    durationMs: clock() - started,
    results,
  };
}
