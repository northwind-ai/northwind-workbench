import type {
  DependencyGraph,
  HistoricalRun,
  RunDelta,
} from "@package-workbench/plugin-sdk";
import type {
  FixPlan,
  PackageIntelligenceReport,
  RefactorPlan,
  WorkbenchRun,
} from "@package-workbench/core";

/**
 * AI Codebase Chat — types. "ChatGPT for the repo", but grounded: every answer
 * is derived from existing Package Workbench intelligence (health, graph,
 * intel, refactor, history) and cites the evidence behind it. No new analysis is
 * performed here; the chat reasons over what the engines already produced.
 *
 * Pure types only. Two reasoning modes: a required offline heuristic engine and
 * an optional, provider-agnostic LLM enhancement.
 */

/**
 * The bundle of Workbench intelligence the chat reasons over — exactly what the
 * desktop/extension already compute. Only `run` is required; richer answers come
 * from the optional pieces.
 */
export interface WorkbenchKnowledge {
  run: WorkbenchRun;
  graph?: DependencyGraph;
  intel?: PackageIntelligenceReport;
  refactor?: RefactorPlan;
  /** Historical runs, newest first. */
  history?: HistoricalRun[];
  /** Latest run compared to its baseline. */
  delta?: RunDelta | null;
  fixPlan?: FixPlan;
}

// ---- Intent ------------------------------------------------------------------

export type QueryType =
  | "health" // "how healthy is X?"
  | "dependency" // "what depends on X?"
  | "architecture" // "where is coupling too high?"
  | "failure" // "why is X unhealthy/failing?"
  | "regression" // "what changed?", "why did score drop?", "CI instability"
  | "refactor" // "what should I refactor first?"
  | "performance" // "which package is largest?"
  | "general"; // anything else → workspace summary

export type Timeframe = "last_run" | "since_last" | "recent" | "all";

export interface Intent {
  type: QueryType;
  /** Package ids/names referenced in the question (resolved against the run). */
  entities: string[];
  timeframe: Timeframe;
  /** The raw question, normalized. */
  question: string;
}

// ---- Context retrieval -------------------------------------------------------

/**
 * The compressed, relevant slice of knowledge selected for a question — never the
 * whole repo. Carries just what reasoning needs, so answers stay focused and
 * (for an LLM) the prompt stays small.
 */
export interface RetrievedContext {
  intent: Intent;
  /** Focal packages (the question's subjects). */
  focus: FocusedPackage[];
  /** Dependents/dependencies of the focus, when relevant. */
  related: Array<{
    id: string;
    relation: "dependent" | "dependency";
    via?: string;
  }>;
  /** Regressions/improvements pulled from the delta, when relevant. */
  regressions: RunDelta["regressions"];
  /** Cycles/violations touching the focus. */
  cycles: string[][];
  /** Notes summarizing what was (and wasn't) available. */
  notes: string[];
}

export interface FocusedPackage {
  id: string;
  name: string;
  score: number;
  status: string;
  runtime: string;
  /** Failing/warning check summaries. */
  issues: string[];
  /** Scenario failures, when scenarios ran. */
  scenarioFailures: number;
}

// ---- Answer ------------------------------------------------------------------

export type Confidence = "low" | "medium" | "high";

export interface SuggestedAction {
  title: string;
  /** A copy-pasteable command, when applicable. */
  command?: string;
}

export interface Evidence {
  /** Where this fact came from: 'health' | 'graph' | 'scenario' | 'history' | … */
  source: string;
  text: string;
}

/** The grounded answer. Always carries its evidence + a confidence. */
export interface ChatAnswer {
  question: string;
  intent: QueryType;
  /** The natural-language answer. */
  answer: string;
  evidence: Evidence[];
  confidence: Confidence;
  suggestedActions: SuggestedAction[];
  /** Package ids the answer references (for clickable links in the UI). */
  references: string[];
  /** Which provider produced it. */
  provider: string;
}

// ---- Session / memory --------------------------------------------------------

export interface ChatTurn {
  question: string;
  answer: ChatAnswer;
}

/** Scoped conversational memory — enables follow-up questions. */
export interface ChatSession {
  turns: ChatTurn[];
  /** Packages currently in focus (carried into follow-ups without an explicit subject). */
  focusEntities: string[];
}

// ---- Providers ---------------------------------------------------------------

export interface AskOptions {
  session?: ChatSession;
  now?: () => string;
}

export interface ChatProvider {
  readonly id: string;
  readonly kind: "heuristic" | "llm";
  isAvailable(): boolean;
  answer(
    context: RetrievedContext,
    knowledge: WorkbenchKnowledge,
  ): Promise<ChatAnswer>;
}

/** Vendor-neutral LLM client (shared shape with the failure assistant). */
export interface LLMClient {
  readonly id: string;
  complete(prompt: string): Promise<string>;
}
