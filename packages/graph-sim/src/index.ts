/**
 * @package-workbench/graph-sim — the Interactive Graph Editor's simulation engine.
 *
 * Simulate architectural changes (remove edges, split/merge packages, add
 * boundaries) and see the predicted impact — recomputed by the real graph engine,
 * never estimated, and never touching the repo. Reuses the Refactor Architect's
 * projection helpers; pairs with it via {@link mutationsFromRefactor} for
 * "Preview refactor".
 */
export * from "./types";
export { simulate, type SimulateOptions } from "./simulate";
export { mutationsFromRefactor } from "./bridge";
export {
  exportSimulationJson,
  exportSimulationMarkdown,
  exportArchitectureDiff,
} from "./export";
