/**
 * Interactive Graph Editor — simulation model. Lets users simulate architectural
 * changes (remove edges, split/merge packages, add boundaries) and see the
 * predicted impact, WITHOUT touching the repo. Pure types only.
 *
 * The simulation engine reuses the Refactor Architect's graph projection +
 * recomputation (no new graph logic): apply mutations to a working copy, then
 * re-run the real graph engine and diff.
 */

export interface EditableNode {
  id: string;
  name: string;
  x: number;
  y: number;
  /** True for nodes the simulation introduces. */
  isNew?: boolean;
}

export interface EditableEdge {
  from: string;
  to: string;
  /** Marked when added/removed by the simulation. */
  change?: "added" | "removed";
}

/** A single architectural change to simulate. */
export type GraphMutation =
  | { type: "add_edge"; from: string; to: string }
  | { type: "remove_edge"; from: string; to: string }
  | { type: "move_node"; id: string; x: number; y: number }
  | {
      type: "split_node";
      id: string;
      parts: { types: string; runtime: string; services: string };
    }
  | { type: "merge_nodes"; ids: string[]; into: string }
  | {
      type: "add_boundary";
      from: string;
      cannotDependOn: string[];
      description?: string;
    };

/** A simulation request: the base graph + an ordered list of mutations. */
export interface GraphSimulation {
  mutations: GraphMutation[];
}

export interface GraphMetrics {
  cycleCount: number;
  violationCount: number;
  healthScore: number;
  grade: string;
  nodeCount: number;
  edgeCount: number;
}

/** The predicted impact of a simulation, all recomputed (not estimated). */
export interface SimulationImpact {
  cycleReduction: number;
  scoreDelta: number;
  violationReduction: number;
  nodeDelta: number;
  edgeDelta: number;
}

export interface SimulationResult {
  before: GraphMetrics;
  after: GraphMetrics;
  impact: SimulationImpact;
  /** Edges added/removed by the mutations (for the before/after diff). */
  changedEdges: Array<{
    from: string;
    to: string;
    change: "added" | "removed";
  }>;
  changedNodes: Array<{ id: string; change: "added" | "removed" }>;
  /** Node positions set by `move_node` mutations (for layout persistence). */
  positions: Record<string, { x: number; y: number }>;
  mutations: GraphMutation[];
  generatedAt: string;
}
