import type { WorkbenchRun } from "../types";
import { fromRun } from "./normalize";
import { HeuristicProvider } from "./provider";
import {
  createFailureMemory,
  defaultMemoryPath,
  fixToResolution,
  type FailureMemory,
} from "./memory";
import type {
  AnalyzeOptions,
  FailureAnalysisInput,
  FailureAssistantProvider,
  FailureExplanation,
} from "./types";

/**
 * The façade the CLI + desktop talk to. Orchestrates: normalize → provider
 * analysis → enrich with prior resolutions from local memory. The provider is
 * injectable (heuristic by default, an LLM provider when configured), and memory
 * is optional — without it the assistant is fully stateless and offline.
 */

export interface FailureAssistant {
  /** Analyze one normalized failure. */
  analyze(
    input: FailureAnalysisInput,
    opts?: AnalyzeOptions,
  ): Promise<FailureExplanation>;
  /** Analyze many, preserving order. */
  analyzeMany(
    inputs: FailureAnalysisInput[],
    opts?: AnalyzeOptions,
  ): Promise<FailureExplanation[]>;
  /** Normalize every failure in a run and explain each. */
  explainRun(
    run: WorkbenchRun,
    opts?: AnalyzeOptions,
  ): Promise<FailureExplanation[]>;
  /** Record that a failure was resolved by a given fix (feeds historical learning). */
  recordResolution(
    input: FailureAnalysisInput,
    fix: { command?: string; detail?: string },
    now?: () => string,
  ): Promise<void>;
  readonly provider: FailureAssistantProvider;
}

export interface FailureAssistantOptions {
  /** Analysis backend. Defaults to the offline heuristic provider. */
  provider?: FailureAssistantProvider;
  /**
   * Historical-learning store. Pass a {@link FailureMemory}, a workspace path
   * (to use the default file location), or omit/`false` to disable memory.
   */
  memory?: FailureMemory | string | false;
  /** Injectable clock for deterministic output. */
  now?: () => string;
}

function resolveMemory(
  memory: FailureAssistantOptions["memory"],
): FailureMemory | null {
  if (!memory) return null;
  if (typeof memory === "string")
    return createFailureMemory(defaultMemoryPath(memory));
  return memory;
}

export function createFailureAssistant(
  options: FailureAssistantOptions = {},
): FailureAssistant {
  const provider = options.provider ?? new HeuristicProvider();
  const memory = resolveMemory(options.memory);
  const now = options.now ?? (() => new Date().toISOString());

  async function analyze(
    input: FailureAnalysisInput,
    opts: AnalyzeOptions = {},
  ): Promise<FailureExplanation> {
    const explanation = await provider.analyze(input, { now, ...opts });
    if (!memory) return explanation;
    const prior = await memory.recall(input);
    return prior ? { ...explanation, priorResolution: prior } : explanation;
  }

  return {
    provider,
    analyze,
    async analyzeMany(inputs, opts) {
      return Promise.all(inputs.map((i) => analyze(i, opts)));
    },
    async explainRun(run, opts) {
      const inputs = fromRun(run);
      return Promise.all(inputs.map((i) => analyze(i, opts)));
    },
    async recordResolution(input, fix, clock = now) {
      if (memory) await memory.record(input, fix, clock);
    },
  };
}

/**
 * One-shot helper: explain a single failure with the default offline engine.
 * Convenience for callers that don't want to manage an assistant instance.
 */
export async function explainFailureInput(
  input: FailureAnalysisInput,
  opts?: AnalyzeOptions,
): Promise<FailureExplanation> {
  return new HeuristicProvider().analyze(input, opts);
}

/** Re-export for callers that auto-record the top suggested fix as the resolution. */
export { fixToResolution };
