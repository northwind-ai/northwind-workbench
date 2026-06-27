import type {
  HealthCheckSeverity,
  PackageManager,
} from "@package-workbench/plugin-sdk";

/**
 * The normalized failure-analysis vocabulary — the contract every input source
 * is folded into and every provider produces. Pure types only (no Node imports)
 * so the desktop renderer can consume them and the heuristic engine stays
 * bundleable anywhere.
 *
 * The design goal is an *honest* senior-engineer explanation: a failure is
 * classified, ranked root-cause hypotheses are generated, each hypothesis cites
 * the concrete evidence behind it, and confidence is derived from how strong
 * that evidence is — never invented.
 */

// ---- Classification ----------------------------------------------------------

/** Coarse family a failure belongs to. Drives routing + UI grouping. */
export type FailureCategory =
  | "dependency"
  | "module"
  | "architecture"
  | "runtime"
  | "build"
  | "infra"
  | "unknown";

/**
 * Fine-grained failure kind within a {@link FailureCategory}. These are the
 * concrete situations the heuristic engine knows how to reason about.
 */
export type FailureKind =
  // dependency
  | "missing_dependency"
  | "peer_mismatch"
  | "version_conflict"
  // module
  | "esm_cjs_mismatch"
  | "broken_exports"
  | "import_failure"
  // architecture
  | "circular_dependency"
  | "boundary_violation"
  | "overcoupling"
  // runtime
  | "runtime_exception"
  | "timeout"
  | "memory_spike"
  // build
  | "missing_build_artifact"
  | "ts_compile_failure"
  // infra
  | "env_missing"
  | "config_invalid"
  // catch-all
  | "unknown";

/** Where a failure was observed. Lets the engine weight evidence by provenance. */
export type FailureSource =
  | "package_health"
  | "scenario"
  | "runtime"
  | "graph"
  | "ci_regression"
  | "crash_log";

// ---- Input model -------------------------------------------------------------

/**
 * Structured signals extracted from a failure that heuristics read directly,
 * instead of re-parsing free text. Populated by the normalizer; every field is
 * optional because sources vary in richness.
 */
export interface FailureSignals {
  /** Bare module specifier that could not be found (e.g. `zod`). */
  missingModule?: string;
  /** Canonical runtime import-failure class, when known (MISSING_DEPENDENCY…). */
  failureClass?: string;
  /** Declared module system of the package: 'module' (ESM) or 'commonjs'. */
  moduleType?: "module" | "commonjs";
  /** Peer dependencies that are unresolved, e.g. `react@^18`. */
  unresolvedPeers?: string[];
  /** Node built-ins used in code that would break in the browser. */
  nodeBuiltins?: string[];
  /** Packages forming a circular dependency, in loop order. */
  cyclePath?: string[];
  /** Source → target of a boundary violation. */
  boundary?: { from: string; to: string; rule: string };
  /** Entry points that were declared but did not resolve on disk. */
  unresolvedEntries?: string[];
  /** Environment variable name that was referenced but absent. */
  envVar?: string;
  /** Wall-clock duration that exceeded a budget, in ms. */
  durationMs?: number;
  /** Peak/observed heap delta, in bytes. */
  memoryBytes?: number;
  /** Exception type captured from a stack (e.g. `TypeError`). */
  errorType?: string;
  /** First package-owned file from a stack trace. */
  offendingFile?: string;
  [key: string]: unknown;
}

/** Everything known about *where* and *how* a failure occurred. */
export interface FailureContext {
  packageId?: string;
  packageName?: string;
  packageManager?: PackageManager;
  workspaceRoot?: string;
  /** Originating check id, when the failure came from a health check. */
  checkId?: string;
  severity?: HealthCheckSeverity;
  /** Raw evidence lines (stack traces, stderr, assertion messages). */
  evidence?: string[];
  /** Structured signals the heuristics consume. */
  signals?: FailureSignals;
}

/** A single failure, normalized from any source into one shape. */
export interface FailureAnalysisInput {
  /**
   * Stable identity for dedup + history. Derived from the failure *signature*
   * (category/kind/subject), never from a timestamp, so the same failure maps to
   * the same id across runs.
   */
  id: string;
  source: FailureSource;
  /** One-line headline, e.g. `Missing dependency: zod`. */
  title: string;
  /** Longer human description, when the source provides one. */
  detail?: string;
  context: FailureContext;
}

// ---- Output model ------------------------------------------------------------

/** A cited piece of evidence. The engine MUST attach these — no claim is free. */
export interface Evidence {
  /** Provenance of the citation: 'check' | 'stack' | 'manifest' | 'graph' | … */
  source: string;
  /** The literal text being cited (a stack frame, a message, a path). */
  text: string;
}

/** A concrete step to confirm or refute a hypothesis. */
export interface ValidationStep {
  description: string;
  /** A shell command to run, when the step is mechanical. */
  command?: string;
}

/** Fast = unblock now; structural = the durable fix that prevents recurrence. */
export type FixKind = "fast" | "structural";

/** An actionable remediation. Prioritized so the UI/CLI can order them. */
export interface FixSuggestion {
  kind: FixKind;
  title: string;
  /** Exact, copy-pasteable shell command, when there is one. */
  command?: string;
  /** Files worth opening/inspecting (workspace-relative or absolute). */
  files?: string[];
  /** Extra detail: a package.json edit, an import to change, etc. */
  detail?: string;
  /** Higher applies first. */
  priority: number;
}

/**
 * One ranked explanation for a failure. The heart of the engine: a stated cause,
 * the evidence behind it, a calibrated confidence, how to validate it, and the
 * fixes it implies.
 */
export interface RootCauseHypothesis {
  category: FailureCategory;
  kind: FailureKind;
  /** One-sentence statement of the cause. */
  cause: string;
  /** Why this happens / how it commonly arises ("why it happened"). */
  rationale?: string;
  /** Evidence supporting *this* hypothesis. Never empty for a real hypothesis. */
  evidence: Evidence[];
  /** 0..1 confidence, derived from the strength of the matched signals. */
  confidence: number;
  /** Steps to confirm or rule this out. */
  validation: ValidationStep[];
  /** Prioritized fixes (fast + structural). */
  fixes: FixSuggestion[];
}

/** A prior, known-good resolution surfaced from local history. */
export interface PriorResolution {
  /** Human line, e.g. `This was fixed previously by adding zod.`. */
  message: string;
  command?: string;
  detail?: string;
  /** When it was last resolved (ISO). */
  resolvedAt: string;
  /** How many times this signature has recurred. */
  occurrences: number;
}

/** The full assistant output for one failure. */
export interface FailureExplanation {
  input: FailureAnalysisInput;
  category: FailureCategory;
  /** Ranked highest-confidence first. */
  hypotheses: RootCauseHypothesis[];
  /** Convenience handle on the top hypothesis (null when none could be formed). */
  primary: RootCauseHypothesis | null;
  /** Whole-explanation confidence (== primary.confidence, or 0). */
  confidence: number;
  /** Id of the provider that produced this. */
  provider: string;
  /** A previously-successful fix for this signature, when history has one. */
  priorResolution?: PriorResolution | null;
  generatedAt: string;
}

// ---- Provider contract -------------------------------------------------------

export interface AnalyzeOptions {
  /** Cap on hypotheses returned (engine still ranks before truncating). */
  maxHypotheses?: number;
  /** Supplies the timestamp; injectable for deterministic tests. */
  now?: () => string;
}

/**
 * The pluggable analysis backend. The heuristic provider is required and always
 * available offline; LLM providers are optional and must degrade to heuristics
 * when unavailable. No provider lock-in: everything speaks this one interface.
 */
export interface FailureAssistantProvider {
  readonly id: string;
  readonly kind: "heuristic" | "llm";
  /** True when usable right now (offline-ok for heuristics; key present for LLM). */
  isAvailable(): boolean;
  analyze(
    input: FailureAnalysisInput,
    opts?: AnalyzeOptions,
  ): Promise<FailureExplanation>;
}

/** A heuristic provider is, additionally, guaranteed to work offline. */
export interface HeuristicAssistantProvider extends FailureAssistantProvider {
  readonly kind: "heuristic";
}

/**
 * The minimal client an {@link LLMAssistantProvider} drives. Deliberately tiny
 * and vendor-neutral — implement it over Claude, a local model, or anything
 * else. Returns raw text; the provider is responsible for prompting + parsing.
 */
export interface LLMClient {
  readonly id: string;
  complete(
    prompt: string,
    opts?: { signal?: { aborted: boolean } },
  ): Promise<string>;
}

export interface LLMAssistantProvider extends FailureAssistantProvider {
  readonly kind: "llm";
  readonly client: LLMClient;
}
