/**
 * AI-powered failure analysis — the assistant that explains failures like a
 * senior engineer. Offline-first: the heuristic engine is required and fully
 * deterministic; LLM providers are optional and strictly additive.
 *
 * Pipeline: normalize (any source → {@link FailureAnalysisInput}) → classify →
 * generate ranked, evidence-cited {@link RootCauseHypothesis} → enrich with
 * prior resolutions from local {@link FailureMemory}. The CLI's `explain`
 * command and the desktop AI Assistant panel both consume this surface.
 */
export * from "./types";
export { classifyFailure, categoryOf, type Classification } from "./classify";
export {
  fromHealthCheck,
  fromPackageReport,
  fromRuntimeReport,
  fromScenarioRun,
  fromGraph,
  fromRegression,
  fromCrashLog,
  fromRun,
  dedupe,
} from "./normalize";
export { generateHypotheses } from "./heuristics";
export {
  HeuristicProvider,
  LLMProvider,
  buildRefinementPrompt,
  type LLMProviderOptions,
} from "./provider";
export {
  createFailureMemory,
  defaultMemoryPath,
  signatureOf,
  fixToResolution,
  type FailureMemory,
  type ResolvedFailureRecord,
} from "./memory";
export {
  createFailureAssistant,
  explainFailureInput,
  type FailureAssistant,
  type FailureAssistantOptions,
} from "./assistant";
export {
  renderExplanationText,
  renderExplanationMarkdown,
  explanationHeadline,
  confidencePercent,
  alternativesText,
} from "./render";
