/**
 * The AI Refactor Architect model. Package Workbench detects architectural
 * problems; this engine proposes *grounded* improvements — every impact number
 * is computed by projecting an "after" graph and re-running the real graph
 * engine on it, not estimated by hand. Pure types only.
 *
 * Two principles run through it: **conservatism** (only suggest a refactor whose
 * recomputed impact is genuinely positive, and never auto-apply anything) and
 * **explainability** (every suggestion cites graph evidence and shows its
 * before/after).
 */

// ---- Architectural problems --------------------------------------------------

export type ArchitecturalSmellKind =
  | "god_package" // too many dependents + responsibilities
  | "overcoupled" // too many edges (fan-in + fan-out)
  | "leaky_abstraction" // internal types exposed across many packages
  | "layer_violation" // forbidden dependency direction
  | "utility_blob" // catch-all helpers everything depends on
  | "feature_fragmentation" // one domain split across many tiny packages
  | "dependency_cycle"; // a circular dependency

export type ProblemSeverity = "low" | "medium" | "high" | "critical";

/** A detected architectural problem, quantified with cited graph evidence. */
export interface ArchitecturalProblem {
  kind: ArchitecturalSmellKind;
  /** The focal package (most problems centre on one). */
  packageId?: string;
  /** Multiple packages, for fragmentation / merge candidates / cycles. */
  packages?: string[];
  severity: ProblemSeverity;
  /** Quantified metrics behind the verdict (fanIn, fanOut, cycles, …). */
  metrics: Record<string, number>;
  /** Cited graph evidence lines. */
  evidence: string[];
  detail: string;
}

// ---- Refactor strategies -----------------------------------------------------

export type RefactorStrategy =
  | "split_package"
  | "merge_packages"
  | "extract_shared_types"
  | "move_dependency"
  | "introduce_boundary"
  | "isolate_runtime_layer"
  | "create_adapter_layer"
  | "delete_dead_package";

/** How risky / costly a refactor is. Conservative gating uses this. */
export type RefactorRiskLevel = "low" | "medium" | "high";

export interface RefactorRisk {
  level: RefactorRiskLevel;
  /** What could go wrong / what to watch. */
  factors: string[];
  effort: "small" | "medium" | "large";
  /** How many packages the change touches (blast radius of the refactor). */
  affectedPackages: number;
}

/**
 * The estimated effect of a refactor — every field is derived by recomputing the
 * graph after a projected change, so it is explainable, not invented.
 */
export interface RefactorImpactEstimate {
  /** Graph-health score change (e.g. +12). */
  healthScoreDelta: number;
  /** Cycles removed (count) and as a fraction of current cycles. */
  cycleReduction: number;
  cycleReductionPct: number;
  /** Reduction in the focal package's fan-out (responsibilities split off). */
  fanOutReduction: number;
  fanOutReductionPct: number;
  /** Net change in internal edges (dependency reduction). */
  dependencyReduction: number;
  /** 0..1 normalised complexity drop (degree/coupling). */
  complexityReduction: number;
  /** Qualitative build-time effect. */
  buildImprovement: string;
  /** How each number was derived (explainability). */
  rationale: string[];
}

// ---- Before/after visualization ---------------------------------------------

export interface ProjectedNode {
  id: string;
  layer: number;
  /** True for a node the refactor introduces. */
  isNew?: boolean;
}

export interface ProjectedGraph {
  nodes: ProjectedNode[];
  edges: Array<{ from: string; to: string }>;
  cycleCount: number;
  healthScore: number;
}

export interface RefactorVisualization {
  /** The affected sub-graph today. */
  before: ProjectedGraph;
  /** The affected sub-graph after the refactor. */
  after: ProjectedGraph;
  changedEdges: Array<{
    from: string;
    to: string;
    change: "added" | "removed";
  }>;
  changedNodes: Array<{
    id: string;
    change: "added" | "removed" | "split" | "merged";
  }>;
}

// ---- Suggestions + plan ------------------------------------------------------

export interface RefactorExplanation {
  /** Why this refactor is recommended (cites the problem). */
  why: string;
  /** Why it helps (cites the recomputed impact). */
  howItHelps: string;
  /** Honest tradeoffs. */
  tradeoffs: string[];
  /** Graph evidence cited. */
  evidence: string[];
}

export interface RefactorSuggestion {
  id: string;
  strategy: RefactorStrategy;
  /** e.g. "Split core into core-types, core-runtime, core-services". */
  title: string;
  /** Packages this refactor operates on. */
  targetPackages: string[];
  /** New packages the refactor would introduce, if any. */
  newPackages: string[];
  /** Concrete, ordered steps. */
  steps: string[];
  problem: ArchitecturalProblem;
  impact: RefactorImpactEstimate;
  risk: RefactorRisk;
  explanation: RefactorExplanation;
  visualization: RefactorVisualization;
  /** Ranking score (higher = recommend first). Derived from impact ÷ risk. */
  score: number;
}

export interface RefactorPlan {
  /** Detected problems, worst-first. */
  problems: ArchitecturalProblem[];
  /** Ranked suggestions (conservative: only positive-impact ones). */
  suggestions: RefactorSuggestion[];
  /** One-line headline. */
  summary: string;
  /** Which alternative-generation pass produced this (0 = primary). */
  variant: number;
  generatedAt: string;
}
