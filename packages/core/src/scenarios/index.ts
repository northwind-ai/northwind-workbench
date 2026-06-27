/**
 * The scenario engine: an assertion evaluator plus an in-process runner with
 * timeouts, cancellation, and bounded parallelism.
 */
export { runScenario, runScenarios, type RunScenariosOptions } from "./runner";
export { evaluateAssertion, getPath, deepEqual } from "./assertions";
